/**
 * Claim packet builder (spec 5.8).
 *
 *   createPacket (after a signed agreement) → confirm facts → documents
 *   accepted → assemble (cover letter + documents, one PDF) → OWNER approves
 *   the exact PDF → recordFiling (online claim ID or mailed) → recordOutcome.
 *
 * The heir is always the claimant and signs the State's claim form; the State
 * pays the heir directly. Stage moves (CLAIM_PACKET_PREPARED, CLAIM_FILED,
 * CLAIM_APPROVED / DENIED / MORE_INFO_REQUESTED) go through transitionCase.
 */
import "server-only";
import { createHash } from "node:crypto";
import { writeAudit, type Actor as AuditActor } from "@/lib/audit";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import { transitionCase } from "@/lib/case/transitions";
import { decryptPii } from "@/lib/crypto/pii";
import { prisma, type DbClient } from "@/lib/db";
import { formatDateOnly, formatNevadaDate, toDateOnly, todayIn } from "@/lib/dates";
import { caseRef } from "@/lib/format";
import type { CaseStage, Role } from "@/lib/generated/prisma/enums";
import { notifyCase } from "@/lib/notifications";
import { readFile, saveFile, sha256Hex } from "@/lib/files/storage";
import { safeFileName, sniffFileType, MAX_UPLOAD_MB } from "@/lib/files/sniff";
import { escapeMd } from "@/lib/agreements/content";
import { formatExactUsd, formatLetterDate } from "@/lib/outreach/content";
import { RELATIONSHIP_PHRASE } from "@/lib/outreach/ai";
import { getBusinessProfile } from "@/lib/outreach/settings";
import { displayName } from "@/lib/normalize/name";
import { getActiveRule } from "@/lib/rules/repository";
import { assemblePacket, AssemblyError } from "./assemble";
import { buildPacketChecklist, packetContents, packetReadiness, type DocRef, type ItemDecision, type PacketFacts } from "./checklist";

export class ClaimError extends Error {}
export { AssemblyError };

export type ClaimActor = { id: string; role: Role };

const OPEN_PACKET = ["IN_PROGRESS", "READY_FOR_REVIEW"] as const;
const PACKET_STAGES: CaseStage[] = ["AGREEMENT_SIGNED", "CLAIM_PACKET_PREPARED", "CLAIM_DENIED", "MORE_INFO_REQUESTED"];

function audit(a: ClaimActor): AuditActor {
  return { type: "USER", id: a.id, role: a.role };
}

function requireWrite(a: ClaimActor) {
  if (!can(a.role, "case:write")) throw new ForbiddenError("Your role cannot work on claim packets.");
}

function requireOwner(a: ClaimActor, what: string) {
  if (!can(a.role, "approval:decide")) throw new ForbiddenError(`Only the OWNER can ${what}.`);
}

export function packetHash(pdfSha256: string, personId: string): string {
  return createHash("sha256").update(JSON.stringify(["CLAIM_PACKET", pdfSha256, personId])).digest("hex");
}

type Event = { at: string; type: string; detail?: string };
const appendEvent = (events: unknown, e: Omit<Event, "at">): Event[] => [...((Array.isArray(events) ? events : []) as Event[]), { at: new Date().toISOString(), ...e }].slice(-100);

function factsOf(raw: unknown, fallback: PacketFacts): PacketFacts {
  const f = (raw ?? {}) as Partial<PacketFacts>;
  return {
    estatePath: f.estatePath === "SMALL_ESTATE" || f.estatePath === "PROBATE" ? f.estatePath : null,
    hasWill: typeof f.hasWill === "boolean" ? f.hasWill : null,
    spouseClaimant: typeof f.spouseClaimant === "boolean" ? f.spouseClaimant : fallback.spouseClaimant,
    multipleHeirs: typeof f.multipleHeirs === "boolean" ? f.multipleHeirs : fallback.multipleHeirs,
  };
}

/** Everything a packet screen or action needs, recomputed from current data. */
export async function packetContext(db: DbClient, packetId: string) {
  const packet = await db.claimPacket.findUniqueOrThrow({ where: { id: packetId } });
  if (!packet.personId) throw new ClaimError("This packet has no claimant.");
  const [c, person] = await Promise.all([
    db.case.findUniqueOrThrow({
      where: { id: packet.caseId },
      include: { owner: true, properties: { select: { statePropertyId: true, category: true, holderName: true, reportedAmountCents: true } } },
    }),
    db.person.findUniqueOrThrow({ where: { id: packet.personId } }),
  ]);
  const rule = await getActiveRule(db, c.stateCode, "CLAIM_REQUIREMENTS", todayIn());
  const heirCount = await db.person.count({ where: { caseId: c.id, status: { not: "REJECTED" }, isPredeceased: false, relationshipConfidence: { gte: 0.6 } } });
  const facts = factsOf(packet.facts, { estatePath: null, hasWill: null, spouseClaimant: person.relationship === "SPOUSE", multipleHeirs: heirCount > 1 });
  const heirDocs = await db.heirDocument.findMany({ where: { caseId: c.id, personId: person.id }, orderBy: { createdAt: "asc" } });
  const files = await db.storedFile.findMany({ where: { id: { in: heirDocs.map((d) => d.fileId) } }, select: { id: true, fileName: true, contentType: true } });
  const documents: DocRef[] = heirDocs.map((d) => {
    const f = files.find((x) => x.id === d.fileId);
    return { documentId: d.id, key: d.checklistKey, fileId: d.fileId, fileName: f?.fileName ?? "file", contentType: f?.contentType ?? "application/octet-stream", status: d.status, uploadedAt: formatNevadaDate(d.createdAt) };
  });
  const signed = await db.agreement.findFirst({ where: { caseId: c.id, personId: person.id, status: "SIGNED" }, orderBy: { signedAt: "desc" } });
  const decisions = (Array.isArray(packet.checklist) ? packet.checklist : []) as ItemDecision[];
  const rows = buildPacketChecklist({ items: rule.params.checklist, facts, documents, decisions, signedAgreementFileId: signed?.signedFileKey ?? signed?.pdfFileKey ?? null });
  const amountCents = c.properties.reduce((s, p) => s + (p.reportedAmountCents ?? 0), 0);
  return { packet, c, person, rule, facts, rows, readiness: packetReadiness(rows), signed, amountCents, notarize: amountCents >= (rule.params.notarizationThresholdCents ?? Infinity) };
}

export async function createPacket(actor: ClaimActor, input: { caseId: string; personId: string }) {
  requireWrite(actor);
  const c = await prisma.case.findUniqueOrThrow({ where: { id: input.caseId }, select: { id: true, stage: true } });
  if (!PACKET_STAGES.includes(c.stage)) throw new ClaimError("A claim packet is built once the agreement is signed.");
  const signed = await prisma.agreement.findFirst({ where: { caseId: c.id, personId: input.personId, status: "SIGNED" } });
  if (!signed) throw new ClaimError("This heir has no signed agreement.");
  const open = await prisma.claimPacket.findFirst({ where: { caseId: c.id, personId: input.personId, status: { in: [...OPEN_PACKET] } } });
  if (open) throw new ClaimError("There is already a packet in progress for this heir.");
  const packet = await prisma.claimPacket.create({ data: { caseId: c.id, personId: input.personId, createdById: actor.id, events: appendEvent([], { type: "created" }) as never } });
  await writeAudit(prisma, { actor: audit(actor), action: "claim_packet.created", entityType: "ClaimPacket", entityId: packet.id, after: { caseId: c.id, personId: input.personId } });
  return packet;
}

async function assertEditable(packetId: string) {
  const p = await prisma.claimPacket.findUniqueOrThrow({ where: { id: packetId } });
  if (p.status !== "IN_PROGRESS" && p.status !== "READY_FOR_REVIEW") throw new ClaimError("This packet was approved; start a new packet to change it.");
  return p;
}

/** Any change before approval invalidates the assembled PDF. */
const unassemble = { assembledPdfKey: null, assembledFrom: undefined, coverLetterText: null, contentHash: null, status: "IN_PROGRESS" as const };

export async function updatePacketFacts(actor: ClaimActor, packetId: string, facts: Partial<PacketFacts>) {
  requireWrite(actor);
  const p = await assertEditable(packetId);
  const next = { ...((p.facts ?? {}) as object), ...facts };
  await prisma.claimPacket.update({ where: { id: packetId }, data: { facts: next as never, ...unassemble, assembledFrom: [] as never, events: appendEvent(p.events, { type: "facts_updated", detail: JSON.stringify(facts) }) as never } });
  await writeAudit(prisma, { actor: audit(actor), action: "claim_packet.facts_updated", entityType: "ClaimPacket", entityId: packetId, after: facts });
}

export async function setItemDecision(actor: ClaimActor, packetId: string, input: { key: string; status: "NOT_APPLICABLE" | "WAIVED" | null; reason: string }) {
  requireWrite(actor);
  if (input.status === "WAIVED") requireOwner(actor, "waive a required document");
  const reason = input.reason.trim();
  if (input.status && reason.length < 5) throw new ClaimError("Give a short reason.");
  const p = await assertEditable(packetId);
  const decisions = ((Array.isArray(p.checklist) ? p.checklist : []) as ItemDecision[]).filter((d) => d.key !== input.key);
  if (input.status) decisions.push({ key: input.key, status: input.status, reason });
  await prisma.claimPacket.update({ where: { id: packetId }, data: { checklist: decisions as never, ...unassemble, assembledFrom: [] as never } });
  await writeAudit(prisma, { actor: audit(actor), action: "claim_packet.item_decided", entityType: "ClaimPacket", entityId: packetId, after: { key: input.key, status: input.status }, reason: reason || undefined });
}

/** A document that reached us another way (mail, in person) — stored like an heir upload. */
export async function uploadForClaimant(actor: ClaimActor, packetId: string, input: { checklistKey: string; fileName: string; bytes: Uint8Array }) {
  requireWrite(actor);
  const p = await assertEditable(packetId);
  if (input.bytes.byteLength > MAX_UPLOAD_MB * 1024 * 1024) throw new ClaimError(`The file is larger than ${MAX_UPLOAD_MB} MB.`);
  const type = sniffFileType(input.bytes);
  if (!type) throw new ClaimError("Upload a PDF or a photo (JPEG, PNG, WebP, HEIC).");
  const ctx = await packetContext(prisma, packetId);
  if (!ctx.rule.params.checklist.some((i) => i.key === input.checklistKey) && input.checklistKey !== "other") throw new ClaimError("Choose a checklist item.");
  await prisma.$transaction(async (tx) => {
    const file = await saveFile(tx, { caseId: p.caseId, kind: "HEIR_UPLOAD", fileName: safeFileName(input.fileName, type.ext), contentType: type.contentType, bytes: input.bytes, uploadedBy: `USER:${actor.id}` });
    const d = await tx.heirDocument.create({ data: { caseId: p.caseId, personId: p.personId!, checklistKey: input.checklistKey, fileId: file.id } });
    await tx.claimPacket.update({ where: { id: packetId }, data: { ...unassemble, assembledFrom: [] as never } });
    await writeAudit(tx, { actor: audit(actor), action: "document.uploaded_by_operator", entityType: "HeirDocument", entityId: d.id, after: { caseId: p.caseId, checklistKey: input.checklistKey, sha256: file.sha256 } });
  });
}

function coverLetter(ctx: Awaited<ReturnType<typeof packetContext>>, enclosures: { label: string; form: string | null; fileName: string }[], business: { legalName: string } | null, today: Date): string {
  const address = ctx.person.mailingAddressEnc ? decryptPii(ctx.person.mailingAddressEnc) : "(address on the claim form)";
  const rel = RELATIONSHIP_PHRASE[ctx.person.relationship];
  const filing = ctx.rule.params.filing;
  const props = ctx.c.properties
    .map((p) => `- State property ID ${escapeMd(p.statePropertyId)}${p.holderName ? ` — reported by ${escapeMd(displayName(p.holderName.toUpperCase()))}` : ""}${p.reportedAmountCents != null ? ` — ${escapeMd(formatExactUsd(p.reportedAmountCents))}` : ""}`)
    .join("\n");
  const encl = enclosures.map((e, i) => `${i + 1}. ${escapeMd(e.label)}${e.form ? ` (form ${e.form})` : ""} — ${escapeMd(e.fileName)}`).join("\n");
  return [
    "# Claim for unclaimed property",
    "",
    `**Date:** ${formatLetterDate(today)}`,
    "",
    filing ? `**To:** ${filing.mailingAddress.map(escapeMd).join(", ")}` : "**To:** Unclaimed Property Division",
    "",
    `**Claimant:** ${escapeMd(ctx.person.fullName)}, ${escapeMd(address)}`,
    "",
    `**Owner (deceased):** ${escapeMd(ctx.c.owner.fullName)}${ctx.c.owner.dateOfDeath ? `, died ${escapeMd(formatLetterDate(ctx.c.owner.dateOfDeath))}` : ""}`,
    "",
    rel ? `**The owner was the claimant's:** ${rel}` : "",
    "",
    "**State claim ID (if filed online):** ________________",
    "",
    "## Property claimed",
    "",
    props,
    "",
    "## Enclosed documents",
    "",
    encl || "None.",
    "",
    `The claimant is filing this claim and asks that payment be made to the claimant.${ctx.notarize ? " Because this claim is $500 or more, the claimant's signature on the claim form is notarized." : ""}`,
    "",
    `These documents were organized with the help of ${escapeMd(business?.legalName ?? "a private company")}, a private company that is not part of, or endorsed by, the State of Nevada or any government agency.`,
    "",
    "Claimant's signature: ______________________________     Date: ______________",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}

export async function assemblePacketFor(actor: ClaimActor, packetId: string) {
  requireWrite(actor);
  await assertEditable(packetId);
  const ctx = await packetContext(prisma, packetId);
  if (!ctx.readiness.ready) throw new ClaimError(`Not ready: ${ctx.readiness.blockers.join(" ")}`);
  const contents = packetContents(ctx.rows);
  const enclosures = [];
  for (const item of contents) {
    const f = await readFile(item.doc.fileId);
    if (!f) throw new ClaimError(`The file for ${item.label} is missing.`);
    enclosures.push({ key: item.key, label: item.label, fileId: item.doc.fileId, fileName: item.doc.fileName, contentType: f.meta.contentType, bytes: f.bytes, sha256: f.meta.sha256 });
  }
  const business = await getBusinessProfile();
  const today = todayIn();
  const reference = `${caseRef(ctx.c.caseNumber, ctx.c.stateCode)}-C`;
  const markdown = coverLetter(
    ctx,
    enclosures.map((e) => ({ label: e.label, form: ctx.rows.find((r) => r.key === e.key)?.form ?? null, fileName: e.fileName })),
    business,
    today,
  );
  const built = await assemblePacket({ coverMarkdown: markdown, reference, enclosures, createdAt: new Date() });
  const file = await saveFile(prisma, { caseId: ctx.c.id, kind: "CLAIM_PACKET", fileName: `${reference} Claim packet.pdf`, contentType: "application/pdf", bytes: built.bytes, uploadedBy: `USER:${actor.id}` });
  const assembledFrom = enclosures.map((e, i) => ({ key: e.key, label: e.label, fileId: e.fileId, fileName: e.fileName, sha256: e.sha256, pages: built.manifest[i]?.pages ?? 0 }));
  await prisma.claimPacket.update({
    where: { id: packetId },
    data: {
      assembledPdfKey: file.id,
      assembledFrom: assembledFrom as never,
      coverLetterText: built.coverText,
      contentHash: packetHash(file.sha256, ctx.person.id),
      status: "READY_FOR_REVIEW",
      events: appendEvent(ctx.packet.events, { type: "assembled", detail: `${built.pages} pages, ${enclosures.length} documents` }) as never,
    },
  });
  await writeAudit(prisma, { actor: audit(actor), action: "claim_packet.assembled", entityType: "ClaimPacket", entityId: packetId, after: { pages: built.pages, documents: assembledFrom.map((a) => a.key), sha256: file.sha256 } });
  return { pages: built.pages };
}

/** OWNER approves the exact assembled PDF. The documents must still be the accepted ones it was built from. */
export async function approvePacket(actor: ClaimActor, packetId: string, input: { contentHash: string; confirmed: boolean }) {
  requireOwner(actor, "approve a claim packet");
  if (!input.confirmed) throw new ClaimError("Tick the box to confirm you checked the whole packet.");
  const ctx = await packetContext(prisma, packetId);
  const p = ctx.packet;
  if (p.status !== "READY_FOR_REVIEW" || !p.assembledPdfKey || !p.contentHash) throw new ClaimError("Assemble the packet before approving it.");
  if (p.contentHash !== input.contentHash) throw new ClaimError("The packet changed after you opened it. Review it again.");
  const file = await readFile(p.assembledPdfKey);
  if (!file || packetHash(sha256Hex(file.bytes), ctx.person.id) !== p.contentHash) throw new ClaimError("The stored packet does not match. Assemble it again.");
  if (!ctx.readiness.ready) throw new ClaimError(`Not ready: ${ctx.readiness.blockers.join(" ")}`);
  const current = packetContents(ctx.rows).map((c) => c.doc.fileId).sort().join(",");
  const built = ((p.assembledFrom ?? []) as { fileId: string }[]).map((a) => a.fileId).sort().join(",");
  if (current !== built) throw new ClaimError("The accepted documents changed since the packet was assembled. Assemble it again.");
  await prisma.$transaction(async (tx) => {
    const approval = await tx.approval.create({
      data: { subjectType: "CLAIM_PACKET", subjectId: p.id, decision: "APPROVED", contentHash: p.contentHash!, contentSnapshot: p.coverLetterText ?? "", checklist: ctx.rows.map((r) => ({ key: r.key, status: r.status })) as never, approvedById: actor.id },
    });
    const u = await tx.claimPacket.updateMany({ where: { id: p.id, status: "READY_FOR_REVIEW", contentHash: p.contentHash }, data: { status: "APPROVED", approvalId: approval.id } });
    if (u.count !== 1) throw new ClaimError("The packet was changed by someone else. Reload and try again.");
    await writeAudit(tx, { actor: audit(actor), action: "claim_packet.approved", entityType: "ClaimPacket", entityId: p.id, after: { approvalId: approval.id, contentHash: p.contentHash } });
  });
  if (ctx.c.stage === "AGREEMENT_SIGNED" || ctx.c.stage === "CLAIM_DENIED") {
    await transitionCase({ caseId: ctx.c.id, to: "CLAIM_PACKET_PREPARED", actor: { type: "USER", id: actor.id, role: actor.role }, reason: "Claim packet approved." });
  }
}

export async function recordFiling(actor: ClaimActor, packetId: string, input: { filedOn: Date; method: "ONLINE" | "MAIL"; claimNumber: string }) {
  requireOwner(actor, "record a filing");
  const p = await prisma.claimPacket.findUniqueOrThrow({ where: { id: packetId } });
  if (p.status !== "APPROVED") throw new ClaimError("Only an approved packet can be filed.");
  const filedOn = toDateOnly(input.filedOn);
  if (filedOn > todayIn()) throw new ClaimError("The filing date can't be in the future.");
  const claimNumber = input.claimNumber.trim().slice(0, 60);
  if (input.method === "ONLINE" && claimNumber.length < 3) throw new ClaimError("Enter the claim ID the State's site gave you.");
  await prisma.claimPacket.update({
    where: { id: p.id },
    data: { status: "FILED", filedAt: filedOn, filedMethod: input.method, stateClaimNumber: claimNumber || null, events: appendEvent(p.events, { type: "filed", detail: `${input.method}${claimNumber ? ` ${claimNumber}` : ""}` }) as never },
  });
  await writeAudit(prisma, { actor: audit(actor), action: "claim_packet.filed", entityType: "ClaimPacket", entityId: p.id, after: { filedOn: formatDateOnly(filedOn), method: input.method, claimNumber } });
  const c = await prisma.case.findUniqueOrThrow({ where: { id: p.caseId }, select: { stage: true } });
  if (c.stage === "CLAIM_PACKET_PREPARED" || c.stage === "MORE_INFO_REQUESTED") {
    await transitionCase({ caseId: p.caseId, to: "CLAIM_FILED", actor: { type: "USER", id: actor.id, role: actor.role }, reason: `Claim filed (${input.method.toLowerCase()}${claimNumber ? `, ${claimNumber}` : ""}).` });
  }
}

const OUTCOME = {
  APPROVED: { packet: "APPROVED_BY_STATE", stage: "CLAIM_APPROVED" },
  DENIED: { packet: "DENIED_BY_STATE", stage: "CLAIM_DENIED" },
  MORE_INFO: { packet: "MORE_INFO_REQUESTED", stage: "MORE_INFO_REQUESTED" },
} as const;

export async function recordOutcome(actor: ClaimActor, packetId: string, input: { outcome: keyof typeof OUTCOME; on: Date; note: string }) {
  requireOwner(actor, "record the State's decision");
  const p = await prisma.claimPacket.findUniqueOrThrow({ where: { id: packetId } });
  if (p.status !== "FILED") throw new ClaimError("Record the decision on a filed packet.");
  const note = input.note.trim().slice(0, 1000);
  if (input.outcome !== "APPROVED" && note.length < 5) throw new ClaimError("Note what the State said (it helps with the next step).");
  const map = OUTCOME[input.outcome];
  await prisma.claimPacket.update({
    where: { id: p.id },
    data: { status: map.packet, outcome: input.outcome, outcomeAt: toDateOnly(input.on), outcomeNote: note || null, events: appendEvent(p.events, { type: `outcome_${input.outcome.toLowerCase()}`, detail: note }) as never },
  });
  await writeAudit(prisma, { actor: audit(actor), action: "claim_packet.outcome", entityType: "ClaimPacket", entityId: p.id, after: { outcome: input.outcome, on: formatDateOnly(toDateOnly(input.on)) }, reason: note || undefined });
  const c = await prisma.case.findUniqueOrThrow({ where: { id: p.caseId }, select: { stage: true } });
  if (c.stage === "CLAIM_FILED") {
    await transitionCase({ caseId: p.caseId, to: map.stage, actor: { type: "USER", id: actor.id, role: actor.role }, reason: `State decision: ${input.outcome.toLowerCase().replace("_", " ")}${note ? ` — ${note}` : ""}` });
  }
  await notifyCase(prisma, { caseId: p.caseId, kind: "CLAIM_UPDATE", title: `The State's decision: ${input.outcome === "APPROVED" ? "approved" : input.outcome === "DENIED" ? "denied" : "more information needed"}` });
}
