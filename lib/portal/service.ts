/**
 * What the heir sees and can do in the portal (spec 5.10): the situation in
 * plain words with the free-claim option first, case status, a message to us,
 * a call-back request, an email for e-signature, document uploads for the
 * claim checklist, and their agreement. Heirs never see other people's data,
 * and uploaded documents are never shown back (only their names and status).
 */
import "server-only";
import { writeAudit } from "@/lib/audit";
import { blindIndex, decryptPii, encryptPii, redactSsnLike } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { formatNevadaDate, todayIn } from "@/lib/dates";
import { caseRef } from "@/lib/format";
import { notifyCase } from "@/lib/notifications";
import { readFile, saveFile } from "@/lib/files/storage";
import { MAX_UPLOAD_MB, safeFileName, sniffFileType } from "@/lib/files/sniff";
import { agreementReference } from "@/lib/agreements/service";
import { getAgreementSettings } from "@/lib/agreements/settings";
import { amountStatement, privateCompanyStatement, propertySummary } from "@/lib/outreach/content";
import { recordInbound, recordOptOut } from "@/lib/outreach/service";
import { getBusinessProfile } from "@/lib/outreach/settings";
import { getActiveRule } from "@/lib/rules/repository";
import { esignProviderStatus } from "@/adapters/esign/status";
import type { PortalContext } from "./access";

export class PortalError extends Error {}

const heir = (ctx: PortalContext) => ({ type: "HEIR" as const, id: ctx.personId });

/** Checklist items an heir can upload for (the claim form and agreement copy are prepared by us). */
const NOT_UPLOADED_BY_HEIR = new Set(["claim_form", "agreement_copy", "notarization"]);

export type PortalStep = { label: string; state: "done" | "current" | "todo" };

function steps(stage: string): PortalStep[] {
  const order = ["found", "contacted", "responded", "agreement", "claim", "paid"] as const;
  const at: Record<string, (typeof order)[number]> = {
    READY_FOR_OUTREACH: "found",
    CONTACTED: "contacted",
    RESPONDED: "responded",
    AGREEMENT_SENT: "agreement",
    AGREEMENT_SIGNED: "claim",
    CLAIM_PACKET_PREPARED: "claim",
    CLAIM_FILED: "claim",
    MORE_INFO_REQUESTED: "claim",
    CLAIM_APPROVED: "paid",
    CLAIM_DENIED: "claim",
    PAID_TO_HEIR: "paid",
    FEE_INVOICED: "paid",
    FEE_COLLECTED: "paid",
    CLOSED_WON: "paid",
  };
  const labels: Record<(typeof order)[number], string> = {
    found: "We found unclaimed property that may belong to your family",
    contacted: "We wrote to you",
    responded: "You got in touch",
    agreement: "Agreement (only if you choose our help)",
    claim: "Preparing and filing the claim with the State",
    paid: "The State decides and pays you directly",
  };
  const idx = order.indexOf(at[stage] ?? "contacted");
  return order.map((k, i) => ({ label: labels[k], state: i < idx ? "done" : i === idx ? "current" : "todo" }));
}

export async function portalView(ctx: PortalContext) {
  const today = todayIn();
  const [person, c, business, settings, docs, agreements] = await Promise.all([
    prisma.person.findUniqueOrThrow({ where: { id: ctx.personId } }),
    prisma.case.findUniqueOrThrow({
      where: { id: ctx.caseId },
      include: { owner: { select: { fullName: true } }, properties: { select: { category: true, holderName: true, reportedAmountCents: true, amountIsMinimum: true } } },
    }),
    getBusinessProfile(),
    getAgreementSettings(),
    prisma.heirDocument.findMany({ where: { personId: ctx.personId, caseId: ctx.caseId }, orderBy: { createdAt: "desc" } }),
    prisma.agreement.findMany({ where: { personId: ctx.personId, caseId: ctx.caseId, status: { in: ["SENT", "SIGNED"] } }, orderBy: { createdAt: "desc" } }),
  ]);
  const [packet, invoices] = await Promise.all([
    prisma.claimPacket.findFirst({
      where: { personId: ctx.personId, caseId: ctx.caseId, status: { in: ["APPROVED", "FILED", "APPROVED_BY_STATE", "DENIED_BY_STATE", "MORE_INFO_REQUESTED"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.invoice.findMany({ where: { personId: ctx.personId, caseId: ctx.caseId, status: { in: ["OPEN", "PAID"] } }, orderBy: { createdAt: "desc" } }),
  ]);
  const [disclosure, claimRule] = await Promise.all([
    getActiveRule(prisma, c.stateCode, "DISCLOSURE_TEXT", today),
    getActiveRule(prisma, c.stateCode, "CLAIM_REQUIREMENTS", today).catch(() => null),
  ]);
  const files = await prisma.storedFile.findMany({ where: { id: { in: docs.map((d) => d.fileId) } }, select: { id: true, fileName: true } });
  const nameOf = new Map(files.map((f) => [f.id, f.fileName]));
  const checklist = (claimRule?.params.checklist ?? [])
    .filter((i) => !NOT_UPLOADED_BY_HEIR.has(i.key))
    .map((i) => ({ key: i.key, label: i.label, condition: i.condition ?? null, required: i.required }));
  checklist.push({ key: "other", label: "Anything else you think will help", condition: null, required: false });
  const esign = esignProviderStatus();
  return {
    firstName: person.fullName.split(/\s+/)[0] ?? person.fullName,
    fullName: person.fullName,
    ownerName: c.owner.fullName,
    reference: caseRef(c.caseNumber, c.stateCode),
    propertySummary: c.properties.length ? propertySummary(c.properties) : null,
    amountSentence: c.properties.length ? amountStatement(c.properties).sentence : null,
    disclosure: { text: disclosure.params.text, website: disclosure.params.claimWebsite, programName: disclosure.params.programName },
    privateCompany: privateCompanyStatement(c.stateCode),
    business,
    bookingUrl: settings.bookingUrl || null,
    steps: steps(c.stage),
    hasEmail: Boolean(person.emailEnc),
    emailHint: person.emailEnc ? maskEmail(decryptPii(person.emailEnc)) : null,
    optedOut: person.doNotContact,
    checklist,
    documents: docs.map((d) => ({ id: d.id, key: d.checklistKey, fileName: nameOf.get(d.fileId) ?? "document", status: d.status, note: d.reviewNote, uploadedAt: formatNevadaDate(d.createdAt) })),
    agreements: agreements.map((a) => ({
      id: a.id,
      reference: agreementReference(a),
      status: a.status,
      method: a.signatureMethod,
      sentAt: formatNevadaDate(a.sentAt) ?? null,
      signedAt: formatNevadaDate(a.signedAt) ?? null,
      hasSignedCopy: Boolean(a.signedFileKey),
      demoSigning: a.esignProvider === "mock-esign" && a.status === "SENT",
      esignVendor: a.esignProvider === "dropbox-sign" ? "Dropbox Sign" : null,
    })),
    esignMock: esign.mock,
    claim: packet
      ? { packetId: packet.id, status: packet.status, filedAt: packet.filedAt?.toISOString().slice(0, 10) ?? null, claimNumber: packet.stateClaimNumber, outcome: packet.outcome, outcomeNote: packet.outcome === "MORE_INFO" ? packet.outcomeNote : null }
      : null,
    claimSiteUrl: claimRule?.params.filing?.onlineUrl ?? disclosure.params.claimWebsite,
    invoices: invoices.map((i) => ({
      id: i.id,
      amountCents: i.amountCents,
      paidToHeirCents: i.amountPaidToHeirCents,
      feeBps: i.feeBps,
      status: i.status,
      dueDate: i.dueDate?.toISOString().slice(0, 10) ?? null,
      paidAt: formatNevadaDate(i.paidAt) ?? null,
      payUrl: i.paymentLinkUrl,
      demoPay: i.status === "OPEN" && i.provider === "mock-payments",
      manual: i.provider === "manual",
    })),
  };
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "on file";
  return `${user.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(6, user.length - 1)))}@${domain}`;
}

function cleanText(s: string, max: number): string {
  return redactSsnLike(s.replace(/\s+/g, " ").trim()).slice(0, max);
}

export async function sendPortalMessage(ctx: PortalContext, text: string) {
  const message = cleanText(text, 3000);
  if (message.length < 2) throw new PortalError("Please write a short message.");
  await recordInbound({ caseId: ctx.caseId, personId: ctx.personId, channel: "PORTAL_MESSAGE", summary: message, createdById: null, auditActor: heir(ctx), advanceToResponded: true });
  await notifyCase(prisma, { caseId: ctx.caseId, kind: "PORTAL_ACTIVITY", title: "New message from an heir in the portal" });
}

export async function requestCall(ctx: PortalContext, input: { phone: string; times: string }) {
  const phone = input.phone.replace(/[^0-9+()\-. ]/g, "").trim();
  if (phone.replace(/\D/g, "").length < 10) throw new PortalError("Please enter a phone number with area code.");
  const times = cleanText(input.times, 300);
  const person = await prisma.person.findUniqueOrThrow({ where: { id: ctx.personId } });
  if (!person.phoneEnc) {
    await prisma.person.update({ where: { id: person.id }, data: { phoneEnc: encryptPii(phone) } });
    await prisma.evidence.create({ data: { caseId: ctx.caseId, personId: person.id, sourceType: "MANUAL_NOTE", title: "Phone number provided by the heir in the portal", extractedFacts: { fieldsProvided: ["phone"], source: "heir-portal" } } });
  }
  await recordInbound({
    caseId: ctx.caseId,
    personId: ctx.personId,
    channel: "PORTAL_MESSAGE",
    summary: `Call-back request${times ? ` — best times: ${times}` : ""}. Phone number provided in the portal (see contact details).`,
    createdById: null,
    auditActor: heir(ctx),
    advanceToResponded: true,
  });
  await notifyCase(prisma, { caseId: ctx.caseId, kind: "PORTAL_ACTIVITY", title: "An heir asked for a call back" });
}

/** The heir gives an email for e-signature. Only when none is on file (changes go through a message). */
export async function provideEmail(ctx: PortalContext, emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) throw new PortalError("Please enter a valid email address.");
  const person = await prisma.person.findUniqueOrThrow({ where: { id: ctx.personId } });
  if (person.emailEnc) throw new PortalError("We already have an email for you. To change it, send us a message.");
  await prisma.$transaction(async (tx) => {
    await tx.person.update({ where: { id: person.id }, data: { emailEnc: encryptPii(email), emailHash: blindIndex(email) } });
    const ev = await tx.evidence.create({ data: { caseId: ctx.caseId, personId: person.id, sourceType: "MANUAL_NOTE", title: "Email provided by the heir in the portal", extractedFacts: { fieldsProvided: ["email"], source: "heir-portal" } } });
    await tx.person.update({ where: { id: person.id }, data: { sourceEvidenceIds: [...new Set([...person.sourceEvidenceIds, ev.id])] } });
    await writeAudit(tx, { actor: heir(ctx), action: "contact.saved", entityType: "Person", entityId: person.id, after: { caseId: ctx.caseId, source: "heir-portal", fields: ["email"] } });
  });
  await notifyCase(prisma, { caseId: ctx.caseId, kind: "PORTAL_ACTIVITY", title: "An heir added an email address in the portal" });
}

export async function uploadDocument(ctx: PortalContext, input: { checklistKey: string; fileName: string; bytes: Uint8Array }) {
  if (input.bytes.byteLength === 0) throw new PortalError("The file is empty.");
  if (input.bytes.byteLength > MAX_UPLOAD_MB * 1024 * 1024) throw new PortalError(`The file is larger than ${MAX_UPLOAD_MB} MB. Try a smaller photo or scan.`);
  const type = sniffFileType(input.bytes);
  if (!type) throw new PortalError("Please upload a PDF or a photo (JPEG, PNG, WebP or iPhone HEIC).");
  const view = await portalView(ctx);
  if (!view.checklist.some((i) => i.key === input.checklistKey)) throw new PortalError("Choose which document this is.");
  const label = view.checklist.find((i) => i.key === input.checklistKey)!.label;
  const doc = await prisma.$transaction(async (tx) => {
    const file = await saveFile(tx, { caseId: ctx.caseId, kind: "HEIR_UPLOAD", fileName: safeFileName(input.fileName, type.ext), contentType: type.contentType, bytes: input.bytes, uploadedBy: `HEIR:${ctx.personId}` });
    const d = await tx.heirDocument.create({ data: { caseId: ctx.caseId, personId: ctx.personId, checklistKey: input.checklistKey, fileId: file.id } });
    await writeAudit(tx, { actor: heir(ctx), action: "document.uploaded", entityType: "HeirDocument", entityId: d.id, after: { caseId: ctx.caseId, checklistKey: input.checklistKey, contentType: type.contentType, sizeBytes: file.sizeBytes, sha256: file.sha256 } });
    return d;
  });
  await recordInbound({ caseId: ctx.caseId, personId: ctx.personId, channel: "PORTAL_MESSAGE", summary: `Uploaded a document: ${label}.`, createdById: null, auditActor: heir(ctx), advanceToResponded: true });
  await notifyCase(prisma, { caseId: ctx.caseId, kind: "DOCUMENT_UPLOADED", title: "An heir uploaded a document", body: label });
  return doc;
}

/** The heir's own agreement PDF (unsigned once sent, or the signed copy). */
export async function heirAgreementFile(ctx: PortalContext, agreementId: string, kind: "unsigned" | "signed") {
  const a = await prisma.agreement.findUnique({ where: { id: agreementId } });
  if (!a || a.personId !== ctx.personId || a.caseId !== ctx.caseId || (a.status !== "SENT" && a.status !== "SIGNED")) return null;
  const key = kind === "signed" ? a.signedFileKey : a.pdfFileKey;
  if (!key) return null;
  const file = await readFile(key);
  if (!file) return null;
  await writeAudit(prisma, { actor: heir(ctx), action: "portal.agreement_downloaded", entityType: "Agreement", entityId: a.id, after: { kind } });
  return file;
}

/** The heir's approved claim packet (their own documents, ready to file). */
export async function heirPacketFile(ctx: PortalContext, packetId: string) {
  const p = await prisma.claimPacket.findUnique({ where: { id: packetId } });
  if (!p || p.personId !== ctx.personId || p.caseId !== ctx.caseId || !p.assembledPdfKey || !["APPROVED", "FILED", "APPROVED_BY_STATE", "DENIED_BY_STATE", "MORE_INFO_REQUESTED"].includes(p.status)) return null;
  const file = await readFile(p.assembledPdfKey);
  if (file) await writeAudit(prisma, { actor: heir(ctx), action: "portal.packet_downloaded", entityType: "ClaimPacket", entityId: p.id });
  return file;
}

export async function optOutFromPortal(ctx: PortalContext, ipAddress?: string) {
  await recordOptOut({ personId: ctx.personId, source: "link", ipAddress });
}
