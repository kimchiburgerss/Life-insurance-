/**
 * Agreements (spec 5.7, compliance rules 1–4 and 7).
 *
 *   createAgreement ── refuses: void period not over, fee above the cap,
 *        │             inexact amounts, missing required terms, wrong stage
 *        ▼
 *   PENDING_APPROVAL ──(OWNER approves the exact PDF + signer)──▶ APPROVED
 *        │                                                         │
 *        └─(reject)─▶ REJECTED                lib/agreements/gateway.ts (the only sender)
 *
 * Nothing here sends anything. Generation stores the PDF encrypted; the
 * approval holds the SHA-256 of the PDF bytes + signer.
 */
import "server-only";
import { createHash } from "node:crypto";
import { writeAudit, type Actor as AuditActor } from "@/lib/audit";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import { aiMockMode } from "@/lib/ai/run";
import { evaluateEligibility, transitionCase } from "@/lib/case/transitions";
import { decryptPii } from "@/lib/crypto/pii";
import { prisma, type DbClient } from "@/lib/db";
import { toDateOnly, todayIn } from "@/lib/dates";
import { caseRef } from "@/lib/format";
import type { Role } from "@/lib/generated/prisma/enums";
import { notifyCase } from "@/lib/notifications";
import { readFile, saveFile, sha256Hex } from "@/lib/files/storage";
import { safeFileName, sniffFileType } from "@/lib/files/sniff";
import { checkDoNotContact, emailHashOf } from "@/lib/outreach/dnc";
import { formatPostalAddress, getBusinessProfile, getOutreachSettings } from "@/lib/outreach/settings";
import { assertFeeWithinCap, feeCapBpsForCase } from "@/lib/rules/engine";
import { getActiveRule } from "@/lib/rules/repository";
import { esignProviderStatus } from "@/adapters/esign/status";
import type { ChecklistItem } from "@/lib/outreach/checklist";
import { buildAgreementChecklist } from "./checklist";
import { agreementVariables, AgreementContentError, fillTemplate, totalValueCents } from "./content";
import { AgreementPdfError, renderAgreementPdf } from "./pdf";
import { currentAgreementTemplate, getAgreementSettings } from "./settings";
import { DEFAULT_GOVERNING_LAW, REQUIRED_FIELD_CHECKS } from "./template";

export class AgreementError extends Error {}
export { AgreementContentError, AgreementPdfError };

export type AgreementActor = { id: string; role: Role };
export type Signer = { personId: string; name: string; email: string | null };

const OPEN = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "SIGNED"] as const;

function audit(a: AgreementActor | "system"): AuditActor {
  return a === "system" ? { type: "SYSTEM", id: "agreements" } : { type: "USER", id: a.id, role: a.role };
}

export function agreementHash(pdfSha256: string, signer: Signer): string {
  return createHash("sha256").update(JSON.stringify(["AGREEMENT", pdfSha256, signer.name, (signer.email ?? "").toLowerCase()])).digest("hex");
}

type StoredChecklist = { items: ChecklistItem[]; evaluatedAt: string; reference: string };

async function rulesFor(db: DbClient, stateCode: string, today: Date) {
  const [waiting, fee, disclosure, requirements] = await Promise.all([
    getActiveRule(db, stateCode, "WAITING_PERIOD", today),
    getActiveRule(db, stateCode, "FEE_CAP", today),
    getActiveRule(db, stateCode, "DISCLOSURE_TEXT", today),
    getActiveRule(db, stateCode, "AGREEMENT_REQUIREMENTS", today),
  ]);
  return { waiting, fee, disclosure, requirements };
}

/**
 * Generate an agreement for one heir. Hard refusals (no override): void
 * period not over (rule 1), fee above the cap (rule 2), value not exactly
 * known or a required term missing (rule 3).
 */
export async function createAgreement(actor: AgreementActor, input: { caseId: string; personId: string; feeBps?: number }) {
  if (!can(actor.role, "case:write")) throw new ForbiddenError("Your role cannot prepare agreements.");
  const today = todayIn();
  const c = await prisma.case.findUniqueOrThrow({
    where: { id: input.caseId },
    include: {
      owner: true,
      properties: { select: { statePropertyId: true, category: true, holderName: true, reportedAmountCents: true, amountIsMinimum: true, dateDeliveredToState: true } },
    },
  });
  const person = await prisma.person.findUniqueOrThrow({ where: { id: input.personId } });
  if (person.caseId !== c.id) throw new AgreementError("That person is not part of this case.");
  if (person.status === "REJECTED" || person.isPredeceased) throw new AgreementError("This person is not a living heir candidate.");
  if (person.doNotContact) throw new AgreementError("This person asked not to be contacted.");
  if (!["RESPONDED", "AGREEMENT_SENT", "AGREEMENT_SIGNED"].includes(c.stage)) {
    throw new AgreementError("Prepare an agreement once the heir has responded (case stage Responded).");
  }

  const { eligibility } = await evaluateEligibility(prisma, c.id, today);
  if (eligibility.status !== "ELIGIBLE") {
    throw new AgreementError(
      eligibility.status === "WAITING"
        ? `NRS 120A.740: an agreement signed before ${eligibility.eligibleContractDate.toISOString().slice(0, 10)} is void. It cannot be generated yet.`
        : `${eligibility.reason} An agreement cannot be generated until every delivery date is known.`,
    );
  }
  const rules = await rulesFor(prisma, c.stateCode, today);
  const capBps = feeCapBpsForCase(c.properties, today, rules.fee.params);
  if (capBps === null) throw new AgreementError("The fee cap cannot be computed (a delivery date is missing).");
  const [business, agreementSettings, template] = await Promise.all([getBusinessProfile(), getAgreementSettings(), currentAgreementTemplate()]);
  if (!business) throw new AgreementError("Fill in the business profile in Settings first.");
  const feeBps = input.feeBps ?? Math.min((await getOutreachSettings()).feeBps, capBps);
  assertFeeWithinCap(feeBps, capBps); // rule 2: refuses to generate above the cap

  const dup = await prisma.agreement.findFirst({ where: { caseId: c.id, personId: person.id, status: { in: [...OPEN] } }, select: { status: true } });
  if (dup) throw new AgreementError(`There is already an agreement with this heir (${dup.status.toLowerCase().replace(/_/g, " ")}). Cancel it first.`);

  const missingTerms = rules.requirements.params.requiredFields.filter((f) => !REQUIRED_FIELD_CHECKS[f]?.test(template.body)).map((f) => REQUIRED_FIELD_CHECKS[f]?.label ?? f);
  if (missingTerms.length) throw new AgreementError(`The agreement template is missing required terms: ${missingTerms.join(", ")}.`);

  const address = person.mailingAddressEnc ? decryptPii(person.mailingAddressEnc) : null;
  if (!address) throw new AgreementError("Add the heir's mailing address first — it goes in the agreement.");
  const email = person.emailEnc ? decryptPii(person.emailEnc) : null;
  totalValueCents(c.properties); // throws a readable error when an amount is not exact

  const count = await prisma.agreement.count({ where: { caseId: c.id } });
  const reference = `${caseRef(c.caseNumber, c.stateCode)}-A${count + 1}`;
  const built = agreementVariables({
    agreementDate: today,
    business: { name: business.legalName, address: formatPostalAddress(business.mailingAddress).join(", "), contactName: business.contactName },
    heir: { name: person.fullName, address },
    ownerName: c.owner.fullName,
    properties: c.properties,
    disclosure: { text: rules.disclosure.params.text, claimWebsite: rules.disclosure.params.claimWebsite },
    feeBps,
    feeCapBps: capBps,
    cancellationDays: agreementSettings.cancellationDays,
    governingLaw: template.attorneyApproved ? "As stated by counsel in this agreement." : DEFAULT_GOVERNING_LAW,
  });
  const markdown = fillTemplate(template.body, built.vars);
  const pdf = await renderAgreementPdf({
    title: `${template.title} — ${reference}`,
    markdown,
    draft: !template.attorneyApproved,
    reference,
    createdAt: new Date(),
    signature: {
      businessName: business.legalName,
      businessSigner: business.contactName,
      businessSignerTitle: business.contactTitle ?? "",
      businessSignedDate: built.vars.agreementDate.replace(/\\/g, ""),
      heirName: person.fullName,
    },
  });
  const signer: Signer = { personId: person.id, name: person.fullName, email };

  const agreement = await prisma.$transaction(async (tx) => {
    const file = await saveFile(tx, {
      caseId: c.id,
      kind: "AGREEMENT_PDF",
      fileName: `${reference} ${template.attorneyApproved ? "" : "DRAFT "}Recovery Agreement.pdf`.replace(/\s+/g, " "),
      contentType: "application/pdf",
      bytes: pdf.bytes,
      uploadedBy: `USER:${actor.id}`,
    });
    const created = await tx.agreement.create({
      data: {
        caseId: c.id,
        personId: person.id,
        signers: [signer] as never,
        feeBps,
        feeCapBps: capBps,
        propertyValueBeforeFeeCents: built.valueBeforeFeeCents,
        propertyValueAfterFeeCents: built.valueAfterFeeCents,
        rulesApplied: Object.values(rules).map((r) => ({ id: r.id, ruleType: r.ruleType, version: r.version, verified: r.verified })) as never,
        templateVersion: template.version,
        isAttorneyApprovedTemplate: template.attorneyApproved,
        pdfFileKey: file.id,
        textContent: pdf.text,
        contentHash: agreementHash(file.sha256, signer),
        status: "PENDING_APPROVAL",
        checklist: { items: [], evaluatedAt: new Date().toISOString(), reference } satisfies StoredChecklist as never,
        createdById: actor.id,
      },
    });
    await writeAudit(tx, {
      actor: audit(actor),
      action: "agreement.generated",
      entityType: "Agreement",
      entityId: created.id,
      after: {
        caseId: c.id,
        personId: person.id,
        reference,
        feeBps,
        feeCapBps: capBps,
        valueBeforeFeeCents: built.valueBeforeFeeCents,
        valueAfterFeeCents: built.valueAfterFeeCents,
        template: template.version,
        attorneyApproved: template.attorneyApproved,
        pdfSha256: file.sha256,
        pages: pdf.pages,
      },
    });
    return created;
  });
  await persistAgreementChecks(agreement.id);
  await notifyCase(prisma, { caseId: c.id, kind: "APPROVAL_NEEDED", title: "Agreement waiting for approval", body: `${reference} — ${person.fullName}` });
  return prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } });
}

type AgreementRow = Awaited<ReturnType<typeof prisma.agreement.findUniqueOrThrow>>;

export function signerOf(a: { signers: unknown }): Signer {
  const s = (Array.isArray(a.signers) ? a.signers[0] : null) as Signer | null;
  if (!s) throw new AgreementError("The agreement has no signer.");
  return s;
}

/** Recompute the checklist from current facts. */
export async function evaluateAgreement(db: DbClient, a: AgreementRow): Promise<ChecklistItem[]> {
  const today = todayIn();
  const c = await db.case.findUniqueOrThrow({
    where: { id: a.caseId },
    include: { properties: { select: { statePropertyId: true, category: true, holderName: true, reportedAmountCents: true, amountIsMinimum: true, dateDeliveredToState: true } } },
  });
  const [{ eligibility }, rules] = await Promise.all([evaluateEligibility(db, a.caseId, today), rulesFor(db, c.stateCode, today)]);
  const signer = signerOf(a);
  const person = a.personId ? await db.person.findUnique({ where: { id: a.personId } }) : null;
  const dnc = person
    ? person.doNotContact
      ? { blocked: true }
      : await checkDoNotContact(db, { normalizedName: person.normalizedName, emailHash: emailHashOf(signer.email) })
    : { blocked: false };
  let amountsExact = true;
  try {
    totalValueCents(c.properties);
  } catch {
    amountsExact = false;
  }
  const text = (a.textContent ?? "").replace(/\s+/g, " ");
  const missingRequired = rules.requirements.params.requiredFields
    .filter((f) => {
      switch (f) {
        case "ownerSignature":
          return !text.includes(`${signer.name} (you)`);
        case "freeClaimDisclosure":
          return !text.includes(rules.disclosure.params.text);
        default:
          return false;
      }
    })
    .map((f) => REQUIRED_FIELD_CHECKS[f]?.label ?? f);
  const other = await db.agreement.count({ where: { id: { not: a.id }, caseId: a.caseId, personId: a.personId, status: { in: [...OPEN] } } });
  return buildAgreementChecklist({
    eligibility,
    unverifiedRules: Object.values(rules).filter((r) => !r.verified).map((r) => r.ruleType),
    caseStage: c.stage,
    feeBps: a.feeBps,
    feeCapBps: feeCapBpsForCase(c.properties, today, rules.fee.params),
    amountsExact,
    missingRequired,
    disclosureInText: text.includes(rules.disclosure.params.text),
    signer: { name: signer.name, email: signer.email, rejected: person?.status === "REJECTED", predeceased: Boolean(person?.isPredeceased), doNotContact: dnc.blocked },
    attorneyApproved: a.isAttorneyApprovedTemplate,
    mockMode: aiMockMode(),
    esignConfigured: esignProviderStatus(),
    otherActiveAgreement: other > 0,
  });
}

async function persistAgreementChecks(id: string) {
  const a = await prisma.agreement.findUniqueOrThrow({ where: { id } });
  const items = await evaluateAgreement(prisma, a);
  const stored = (a.checklist as StoredChecklist | null) ?? { reference: "", items: [], evaluatedAt: "" };
  await prisma.agreement.update({ where: { id }, data: { checklist: { ...stored, items, evaluatedAt: new Date().toISOString() } as never } });
  return items;
}

export function agreementReference(a: { checklist: unknown }): string {
  return (a.checklist as StoredChecklist | null)?.reference ?? "Agreement";
}

/**
 * OWNER approves the exact PDF + signer they reviewed and chooses how it is
 * signed. Red checklist items block; e-signature needs an email and a service.
 */
export async function approveAgreement(
  actor: AgreementActor,
  id: string,
  input: { contentHash: string; confirmed: boolean; method: "ESIGN" | "PAPER"; ipAddress?: string },
) {
  if (!can(actor.role, "approval:decide")) throw new ForbiddenError("Only the OWNER can approve agreements.");
  if (!input.confirmed) throw new AgreementError("Tick the box to confirm you read the whole agreement.");
  return prisma.$transaction(async (tx) => {
    const a = await tx.agreement.findUniqueOrThrow({ where: { id } });
    if (a.status !== "PENDING_APPROVAL") throw new AgreementError(`This agreement is ${a.status.toLowerCase().replace(/_/g, " ")}, not waiting for approval.`);
    if (!a.contentHash || a.contentHash !== input.contentHash) throw new AgreementError("The agreement changed after you opened it. Review it again.");
    const file = a.pdfFileKey ? await readFile(a.pdfFileKey, tx) : null;
    const signer = signerOf(a);
    if (!file || agreementHash(file.meta.sha256, signer) !== a.contentHash || sha256Hex(file.bytes) !== file.meta.sha256) {
      throw new AgreementError("The stored PDF does not match this agreement. Cancel it and generate a new one.");
    }
    const items = await evaluateAgreement(tx, a);
    const failing = items.filter((i) => i.status === "fail");
    if (failing.length) throw new AgreementError(`Not every check is green: ${failing.map((i) => i.label).join("; ")}.`);
    if (input.method === "ESIGN") {
      if (!signer.email) throw new AgreementError("There is no email for electronic signature. Choose paper, or cancel and prepare it again after the heir adds an email.");
      if (!esignProviderStatus().ok) throw new AgreementError("No e-signature service is configured. Choose paper.");
    }
    const approval = await tx.approval.create({
      data: {
        subjectType: "AGREEMENT",
        subjectId: a.id,
        decision: "APPROVED",
        contentHash: a.contentHash,
        contentSnapshot: a.textContent ?? "",
        checklist: items as never,
        reason: `Signature method: ${input.method === "ESIGN" ? "electronic" : "paper"}`,
        approvedById: actor.id,
      },
    });
    const updated = await tx.agreement.updateMany({
      where: { id: a.id, status: "PENDING_APPROVAL", contentHash: a.contentHash },
      data: { status: "APPROVED", approvalId: approval.id, signatureMethod: input.method },
    });
    if (updated.count !== 1) throw new AgreementError("The agreement was changed by someone else. Reload and try again.");
    await writeAudit(tx, {
      actor: audit(actor),
      action: "agreement.approved",
      entityType: "Agreement",
      entityId: a.id,
      after: { approvalId: approval.id, contentHash: a.contentHash, method: input.method },
      ipAddress: input.ipAddress,
    });
    return approval;
  });
}

export async function rejectAgreement(actor: AgreementActor, id: string, reason: string) {
  if (!can(actor.role, "approval:decide")) throw new ForbiddenError("Only the OWNER can reject agreements.");
  const why = reason.trim();
  if (why.length < 5) throw new AgreementError("Say briefly why it is rejected.");
  await prisma.$transaction(async (tx) => {
    const a = await tx.agreement.findUniqueOrThrow({ where: { id } });
    if (a.status !== "PENDING_APPROVAL" && a.status !== "DRAFT") throw new AgreementError("Only agreements waiting for approval can be rejected.");
    const approval = await tx.approval.create({
      data: { subjectType: "AGREEMENT", subjectId: a.id, decision: "REJECTED", contentHash: a.contentHash ?? "", contentSnapshot: a.textContent ?? "", reason: why, approvedById: actor.id },
    });
    await tx.agreement.update({ where: { id }, data: { status: "VOIDED", statusReason: `Rejected: ${why}` } });
    await writeAudit(tx, { actor: audit(actor), action: "agreement.rejected", entityType: "Agreement", entityId: id, after: { approvalId: approval.id }, reason: why });
  });
}

/**
 * A paper signature, scanned and uploaded by the OWNER. The signing date must
 * be on or after the eligible contract date — an earlier one would be void.
 */
export async function recordPaperSignature(actor: AgreementActor, id: string, input: { bytes: Uint8Array; fileName: string; signedOn: Date }) {
  if (!can(actor.role, "approval:decide")) throw new ForbiddenError("Only the OWNER can record a signed agreement.");
  const a = await prisma.agreement.findUniqueOrThrow({ where: { id } });
  if (a.status !== "SENT" || a.signatureMethod !== "PAPER") throw new AgreementError("Only an approved agreement sent for paper signature can be recorded as signed.");
  const type = sniffFileType(input.bytes);
  if (!type) throw new AgreementError("Upload the signed agreement as a PDF or a photo (JPEG, PNG, WebP, HEIC).");
  const signedOn = toDateOnly(input.signedOn);
  if (signedOn > todayIn()) throw new AgreementError("The signing date cannot be in the future.");
  const { eligibility } = await evaluateEligibility(prisma, a.caseId, todayIn());
  if (eligibility.status !== "ELIGIBLE" || signedOn < eligibility.eligibleContractDate) {
    throw new AgreementError("NRS 120A.740: an agreement signed before the end of the 24-month period is void. Check the date.");
  }
  if (a.sentAt && signedOn < toDateOnly(a.sentAt)) throw new AgreementError("The signing date is before the agreement was sent.");
  await prisma.$transaction(async (tx) => {
    const file = await saveFile(tx, { caseId: a.caseId, kind: "PAPER_SIGNATURE", fileName: safeFileName(input.fileName, type.ext), contentType: type.contentType, bytes: input.bytes, uploadedBy: `USER:${actor.id}` });
    await tx.agreement.update({ where: { id }, data: { status: "SIGNED", signedAt: signedOn, signedFileKey: file.id } });
    await writeAudit(tx, { actor: audit(actor), action: "agreement.signed_on_paper", entityType: "Agreement", entityId: id, after: { signedOn: signedOn.toISOString().slice(0, 10), fileId: file.id, sha256: file.sha256 } });
  });
  await advanceOnSigned(a.caseId);
}

/** Move the case to AGREEMENT_SIGNED (from AGREEMENT_SENT) once an agreement is signed. */
export async function advanceOnSigned(caseId: string) {
  const c = await prisma.case.findUniqueOrThrow({ where: { id: caseId }, select: { stage: true } });
  if (c.stage === "AGREEMENT_SENT") {
    await transitionCase({ caseId, to: "AGREEMENT_SIGNED", actor: { type: "SYSTEM", id: "agreements" }, reason: "Agreement signed." }).catch(async (e) => {
      await notifyCase(prisma, { caseId, kind: "SYSTEM", title: "Agreement signed, but the case could not move to Agreement signed", body: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    });
  }
  await notifyCase(prisma, { caseId, kind: "AGREEMENT_SIGNED", title: "An agreement was signed" });
}

export function storedAgreementChecklist(a: { checklist: unknown }): ChecklistItem[] {
  return (a.checklist as StoredChecklist | null)?.items ?? [];
}
