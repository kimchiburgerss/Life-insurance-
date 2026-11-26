/**
 * Phase 5, end to end in mock mode: generate an agreement (with the rule
 * refusals), approve the exact PDF, send through the single gateway, the heir
 * signs in the portal, the case advances; paper signing; and the heir portal
 * (link → session, messages, email, uploads, own documents only).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockESignProvider } from "@/adapters/esign/mock";
import { ForbiddenError } from "@/lib/auth/permissions";
import { blindIndex, encryptPii } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { addDays, addMonths, todayIn } from "@/lib/dates";
import type { CaseStage, Role } from "@/lib/generated/prisma/enums";
import { applyESignEvent, cancelAgreement, dispatchAgreement, simulateMockSignature, AgreementSendRefused } from "@/lib/agreements/gateway";
import { AgreementContentError, AgreementError, approveAgreement, createAgreement, evaluateAgreement, recordPaperSignature } from "@/lib/agreements/service";
import { encryptBytes } from "@/lib/files/crypto";
import { readFile, sha256Hex } from "@/lib/files/storage";
import { createDraft } from "@/lib/outreach/service";
import { saveBusinessProfile } from "@/lib/outreach/settings";
import { ensurePortalAccess, portalContextFromSecret, revokePortalAccess, startPortalSession } from "@/lib/portal/access";
import { allowRequest } from "@/lib/portal/rate-limit";
import { heirAgreementFile, PortalError, portalView, provideEmail, sendPortalMessage, uploadDocument } from "@/lib/portal/service";
import { FeeCapExceededError } from "@/lib/rules/engine";
import { makeUser } from "../helpers/factories";

const today = todayIn();
let owner: { id: string; role: Role };
let researcher: { id: string; role: Role };
const RULES = ["WAITING_PERIOD", "FEE_CAP", "DISCLOSURE_TEXT", "AGREEMENT_REQUIREMENTS"] as const;
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n% scanned death certificate (test)\n%%EOF\n");

async function caseAt(stage: CaseStage, opts: { monthsAgo?: number; amount?: number | null; minimum?: boolean; email?: boolean } = {}) {
  const tag = randomUUID().slice(0, 8);
  const o = await prisma.owner.create({ data: { fullName: `Agnes Test${tag}`, normalizedName: `AGNES TEST${tag}`.toUpperCase() } });
  const c = await prisma.case.create({
    data: {
      ownerId: o.id,
      stage,
      properties: {
        create: [
          {
            statePropertyId: `AGR-${tag}`,
            ownerNameRaw: `ESTATE OF AGNES TEST${tag}`,
            ownerId: o.id,
            category: "LIFE_INSURANCE",
            holderName: "SILVER SAGE MUTUAL LIFE INSURANCE CO",
            reportedAmountCents: opts.amount === undefined ? 1_000_000 : opts.amount,
            amountIsMinimum: opts.minimum ?? false,
            dateDeliveredToState: addMonths(today, -(opts.monthsAgo ?? 30), "rollForward"),
            rawRecord: { test: true },
          },
        ],
      },
    },
  });
  const ev = await prisma.evidence.create({ data: { caseId: c.id, sourceType: "OBITUARY", supportsDeath: true, title: "Obituary (test)" } });
  const email = `heir-${tag}@example.com`;
  const heir = await prisma.person.create({
    data: {
      caseId: c.id,
      fullName: `Morgan Test${tag}`,
      normalizedName: `MORGAN TEST${tag}`.toUpperCase(),
      relationship: "CHILD",
      relationshipConfidence: 0.9,
      status: "CONFIRMED",
      sourceEvidenceIds: [ev.id],
      mailingAddressEnc: encryptPii(`${Math.floor(Math.random() * 9000) + 100} Elm St, Reno, NV 89502`),
      ...(opts.email === false ? {} : { emailEnc: encryptPii(email), emailHash: blindIndex(email) }),
    },
  });
  return { c, heir };
}

async function approveAndSend(agreementId: string, method: "ESIGN" | "PAPER" = "ESIGN") {
  const a = await prisma.agreement.findUniqueOrThrow({ where: { id: agreementId } });
  await approveAgreement(owner, agreementId, { contentHash: a.contentHash!, confirmed: true, method });
  return dispatchAgreement(agreementId);
}

beforeAll(async () => {
  owner = { id: (await makeUser("OWNER")).user.id, role: "OWNER" };
  researcher = { id: (await makeUser("RESEARCHER")).user.id, role: "RESEARCHER" };
  await saveBusinessProfile(owner, {
    legalName: "Test Recovery LLC",
    contactName: "Pat Rivera",
    contactTitle: "Owner",
    mailingAddress: { line1: "100 W Liberty St", line2: "", city: "Reno", state: "NV", zip: "89501" },
    phone: "775-555-0100",
    email: "pat@example.com",
    website: "",
  });
  await prisma.jurisdictionRule.updateMany({ where: { stateCode: "NV", ruleType: { in: [...RULES] } }, data: { lastVerifiedAt: new Date(), verifiedBy: "test" } });
});

afterAll(async () => {
  await prisma.jurisdictionRule.updateMany({ where: { stateCode: "NV", ruleType: { in: [...RULES] } }, data: { lastVerifiedAt: null, verifiedBy: null } });
  await prisma.$disconnect();
});

describe("agreement generation refuses what the rules forbid", () => {
  it("generates a validated DRAFT agreement and stores the PDF encrypted", async () => {
    const { c, heir } = await caseAt("RESPONDED");
    const a = await createAgreement(researcher, { caseId: c.id, personId: heir.id });
    expect(a).toMatchObject({ status: "PENDING_APPROVAL", feeBps: 1000, feeCapBps: 1000, propertyValueBeforeFeeCents: 1_000_000, propertyValueAfterFeeCents: 900_000, isAttorneyApprovedTemplate: false });
    expect(a.textContent).toContain("DRAFT — must be reviewed by a licensed attorney before use");
    const stored = await prisma.storedFile.findUniqueOrThrow({ where: { id: a.pdfFileKey! } });
    expect(Buffer.from(stored.data).includes(Buffer.from("%PDF"))).toBe(false); // encrypted at rest
    const file = await readFile(a.pdfFileKey!);
    expect(file!.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const items = await evaluateAgreement(prisma, a);
    expect(items.filter((i) => i.status === "fail")).toEqual([]);
    expect(items.find((i) => i.key === "attorney")?.status).toBe("warn");
  });

  it("refuses a fee above the legal cap — no agreement is created (rule 2)", async () => {
    const { c, heir } = await caseAt("RESPONDED");
    await expect(createAgreement(owner, { caseId: c.id, personId: heir.id, feeBps: 1500 })).rejects.toBeInstanceOf(FeeCapExceededError);
    expect(await prisma.agreement.count({ where: { caseId: c.id } })).toBe(0);
  });

  it("allows the 20% tier only when every property was delivered 5+ years ago", async () => {
    const { c, heir } = await caseAt("RESPONDED", { monthsAgo: 61 });
    const a = await createAgreement(owner, { caseId: c.id, personId: heir.id, feeBps: 2000 });
    expect(a.feeCapBps).toBe(2000);
  });

  it("refuses during the 24-month void period (rule 1)", async () => {
    const { c, heir } = await caseAt("RESPONDED", { monthsAgo: 12 });
    await expect(createAgreement(owner, { caseId: c.id, personId: heir.id })).rejects.toThrow(/NRS 120A\.740.*void/);
  });

  it("refuses when the value isn't exactly known (rule 3: value before and after the fee)", async () => {
    const a = await caseAt("RESPONDED", { amount: null });
    await expect(createAgreement(owner, { caseId: a.c.id, personId: a.heir.id })).rejects.toBeInstanceOf(AgreementContentError);
    const b = await caseAt("RESPONDED", { minimum: true });
    await expect(createAgreement(owner, { caseId: b.c.id, personId: b.heir.id })).rejects.toThrow(/exact amount/);
  });

  it("refuses before the heir has responded, and a second open agreement with the same heir", async () => {
    const early = await caseAt("CONTACTED");
    await expect(createAgreement(owner, { caseId: early.c.id, personId: early.heir.id })).rejects.toBeInstanceOf(AgreementError);
    const { c, heir } = await caseAt("RESPONDED");
    await createAgreement(owner, { caseId: c.id, personId: heir.id });
    await expect(createAgreement(owner, { caseId: c.id, personId: heir.id })).rejects.toThrow(/already an agreement/);
  });
});

describe("approval gate and sending (rule 7)", () => {
  it("OWNER approves the exact PDF; the gateway sends it; the heir signs; the case advances", async () => {
    const { c, heir } = await caseAt("RESPONDED");
    const a = await createAgreement(owner, { caseId: c.id, personId: heir.id });
    await expect(approveAgreement(researcher, a.id, { contentHash: a.contentHash!, confirmed: true, method: "ESIGN" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveAgreement(owner, a.id, { contentHash: "stale", confirmed: true, method: "ESIGN" })).rejects.toThrow(/changed after you opened it/);

    expect(await approveAndSend(a.id)).toEqual({ status: "SENT", method: "ESIGN" });
    const sent = await prisma.agreement.findUniqueOrThrow({ where: { id: a.id } });
    expect(sent).toMatchObject({ status: "SENT", esignProvider: "mock-esign" });
    expect(MockESignProvider.store.get(sent.esignEnvelopeId!)?.req.signer.name).toBe(heir.fullName);
    expect((await prisma.case.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("AGREEMENT_SENT");
    const approval = await prisma.approval.findUniqueOrThrow({ where: { id: sent.approvalId! } });
    expect(approval).toMatchObject({ subjectType: "AGREEMENT", decision: "APPROVED", approvedById: owner.id, contentHash: sent.contentHash });

    await simulateMockSignature(a.id, heir.id);
    const signed = await prisma.agreement.findUniqueOrThrow({ where: { id: a.id } });
    expect(signed.status).toBe("SIGNED");
    expect((await readFile(signed.signedFileKey!))!.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await prisma.case.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("AGREEMENT_SIGNED");
    const actions = (await prisma.auditLog.findMany({ where: { entityId: a.id }, orderBy: { id: "asc" } })).map((x) => x.action);
    expect(actions).toEqual(["agreement.generated", "agreement.approved", "agreement.sent", "agreement.signed"]);
    // A replayed event is ignored.
    expect(await applyESignEvent({ eventId: `mock-${a.id}-signed`, type: "ALL_SIGNED", requestId: sent.esignEnvelopeId!, occurredAt: new Date() })).toEqual({ handled: true, duplicate: true });
  });

  it("the gateway refuses an unapproved agreement, and the database refuses SENT/SIGNED without an approval", async () => {
    const { c, heir } = await caseAt("RESPONDED");
    const a = await createAgreement(owner, { caseId: c.id, personId: heir.id });
    await expect(dispatchAgreement(a.id)).rejects.toBeInstanceOf(AgreementSendRefused);
    await expect(prisma.agreement.update({ where: { id: a.id }, data: { status: "SENT" } })).rejects.toThrow(/without an approval/);
    await expect(prisma.agreement.update({ where: { id: a.id }, data: { status: "SIGNED" } })).rejects.toThrow(/without an approval/);
  });

  it("approved terms can't be changed, and a swapped PDF is refused at send time", async () => {
    const { c, heir } = await caseAt("RESPONDED");
    const a = await createAgreement(owner, { caseId: c.id, personId: heir.id });
    await approveAgreement(owner, a.id, { contentHash: a.contentHash!, confirmed: true, method: "ESIGN" });
    await expect(prisma.agreement.update({ where: { id: a.id }, data: { feeBps: 900 } })).rejects.toThrow(/can no longer be edited/);
    await expect(prisma.agreement.update({ where: { id: a.id }, data: { textContent: "changed" } })).rejects.toThrow(/can no longer be edited/);
    // Swap the stored PDF (with a consistent checksum) behind the approval's back.
    const fake = new TextEncoder().encode("%PDF-1.4 forged terms");
    await prisma.storedFile.update({ where: { id: a.pdfFileKey! }, data: { data: new Uint8Array(encryptBytes(fake)), sha256: sha256Hex(fake) } });
    await expect(dispatchAgreement(a.id)).rejects.toThrow(/does not match what was approved/);
  });

  it("e-signature needs an email; paper signing works and refuses a void signing date", async () => {
    const { c, heir } = await caseAt("RESPONDED", { email: false });
    const a = await createAgreement(owner, { caseId: c.id, personId: heir.id });
    await expect(approveAgreement(owner, a.id, { contentHash: a.contentHash!, confirmed: true, method: "ESIGN" })).rejects.toThrow(/no email/);
    expect(await approveAndSend(a.id, "PAPER")).toEqual({ status: "SENT", method: "PAPER" });
    const eligibleFrom = (await prisma.case.findUniqueOrThrow({ where: { id: c.id } })).eligibleContractDate!;
    await expect(recordPaperSignature(owner, a.id, { bytes: PDF_BYTES, fileName: "signed.pdf", signedOn: addDays(eligibleFrom, -1) })).rejects.toThrow(/void/);
    await expect(recordPaperSignature(owner, a.id, { bytes: new TextEncoder().encode("<html>"), fileName: "x.html", signedOn: today })).rejects.toThrow(/PDF or a photo/);
    await recordPaperSignature(owner, a.id, { bytes: PDF_BYTES, fileName: "signed.pdf", signedOn: today });
    expect((await prisma.agreement.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("SIGNED");
    expect((await prisma.case.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("AGREEMENT_SIGNED");
  });

  it("a declined or cancelled agreement is recorded", async () => {
    const one = await caseAt("RESPONDED");
    const a = await createAgreement(owner, { caseId: one.c.id, personId: one.heir.id });
    await approveAndSend(a.id);
    const env = (await prisma.agreement.findUniqueOrThrow({ where: { id: a.id } })).esignEnvelopeId!;
    await applyESignEvent({ eventId: `evt-${randomUUID()}`, type: "DECLINED", requestId: env, occurredAt: new Date() });
    expect((await prisma.agreement.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DECLINED");
    expect(await prisma.notification.count({ where: { caseId: one.c.id, kind: "AGREEMENT_DECLINED" } })).toBeGreaterThan(0);

    const two = await caseAt("RESPONDED");
    const b = await createAgreement(owner, { caseId: two.c.id, personId: two.heir.id });
    await approveAndSend(b.id);
    await cancelAgreement(owner, b.id, "Heir decided to file directly");
    const cancelled = await prisma.agreement.findUniqueOrThrow({ where: { id: b.id } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(MockESignProvider.store.get(cancelled.esignEnvelopeId!)?.cancelled).toBe(true);
  });
});

describe("heir portal", () => {
  it("the letter link opens a session; revoked or wrong links don't", async () => {
    const { c, heir } = await caseAt("CONTACTED");
    const access = await ensurePortalAccess(prisma, { caseId: c.id, personId: heir.id });
    expect(access.url).toMatch(/\/p\/[a-z2-9]{20}$/);
    expect((await ensurePortalAccess(prisma, { caseId: c.id, personId: heir.id })).token).toBe(access.token); // reused
    const stored = await prisma.portalAccess.findUniqueOrThrow({ where: { id: access.id } });
    expect(stored.tokenHash).not.toContain(access.token);

    const session = await startPortalSession(access.token);
    expect(session).not.toBeNull();
    const ctx = await portalContextFromSecret(session!.secret);
    expect(ctx).toMatchObject({ personId: heir.id, caseId: c.id });
    expect(await startPortalSession("aaaaaaaaaaaaaaaaaaaa")).toBeNull();
    expect(await portalContextFromSecret("not-a-real-session-secret-value")).toBeNull();

    await revokePortalAccess(owner, access.id, "test");
    expect(await portalContextFromSecret(session!.secret)).toBeNull();
    expect(await startPortalSession(access.token)).toBeNull();
  });

  it("letters carry the heir's portal link", async () => {
    const { c, heir } = await caseAt("READY_FOR_OUTREACH");
    const draft = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    const access = await ensurePortalAccess(prisma, { caseId: c.id, personId: heir.id });
    expect(draft.textContent).toContain(`/p/${access.token}`);
    expect(draft.templateVersion).toBe("2");
  });

  it("a portal message counts as a reply: the case moves to RESPONDED", async () => {
    const { c, heir } = await caseAt("CONTACTED");
    const access = await ensurePortalAccess(prisma, { caseId: c.id, personId: heir.id });
    const ctx = (await portalContextFromSecret((await startPortalSession(access.token))!.secret))!;
    await sendPortalMessage(ctx, "Yes, I would like your help. My SSN is 123-45-6789 if you need it.");
    const msg = await prisma.communication.findFirstOrThrow({ where: { caseId: c.id, direction: "INBOUND" } });
    expect(msg.channel).toBe("PORTAL_MESSAGE");
    expect(msg.textContent).toContain("[REDACTED-SSN]");
    expect((await prisma.case.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("RESPONDED");
  });

  it("uploads are type-checked, encrypted and listed; the heir can add an email once", async () => {
    const { c, heir } = await caseAt("RESPONDED", { email: false });
    const access = await ensurePortalAccess(prisma, { caseId: c.id, personId: heir.id });
    const ctx = (await portalContextFromSecret((await startPortalSession(access.token))!.secret))!;
    const doc = await uploadDocument(ctx, { checklistKey: "death_certificate", fileName: "../cert.pdf", bytes: PDF_BYTES });
    const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: doc.fileId } });
    expect(file).toMatchObject({ kind: "HEIR_UPLOAD", contentType: "application/pdf", fileName: "cert.pdf", uploadedBy: `HEIR:${heir.id}` });
    expect(Buffer.from(file.data).includes(Buffer.from("death certificate"))).toBe(false);
    await expect(uploadDocument(ctx, { checklistKey: "death_certificate", fileName: "virus.exe", bytes: new TextEncoder().encode("MZ\x90\0 not a document at all") })).rejects.toBeInstanceOf(PortalError);
    await expect(uploadDocument(ctx, { checklistKey: "claim_form", fileName: "a.pdf", bytes: PDF_BYTES })).rejects.toThrow(/Choose which document/);
    const view = await portalView(ctx);
    expect(view.documents.map((d) => d.key)).toEqual(["death_certificate"]);
    expect(view.disclosure.text).toContain("for free");

    await provideEmail(ctx, "Morgan@Example.com");
    await expect(provideEmail(ctx, "other@example.com")).rejects.toThrow(/already have an email/);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: heir.id } })).emailHash).toBe(blindIndex("morgan@example.com"));
  });

  it("an heir can only download their own agreement, and only once it was sent", async () => {
    const one = await caseAt("RESPONDED");
    const two = await caseAt("RESPONDED");
    const a = await createAgreement(owner, { caseId: one.c.id, personId: one.heir.id });
    const ctxOne = (await portalContextFromSecret((await startPortalSession((await ensurePortalAccess(prisma, { caseId: one.c.id, personId: one.heir.id })).token))!.secret))!;
    const ctxTwo = (await portalContextFromSecret((await startPortalSession((await ensurePortalAccess(prisma, { caseId: two.c.id, personId: two.heir.id })).token))!.secret))!;
    expect(await heirAgreementFile(ctxOne, a.id, "unsigned")).toBeNull(); // not approved/sent yet
    await approveAndSend(a.id);
    expect((await heirAgreementFile(ctxOne, a.id, "unsigned"))?.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await heirAgreementFile(ctxTwo, a.id, "unsigned")).toBeNull();
    await expect(simulateMockSignature(a.id, two.heir.id)).rejects.toBeInstanceOf(AgreementSendRefused);
  });

  it("public endpoints are rate limited", async () => {
    const key = `test:${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await allowRequest(key, 3, 60));
    expect(results).toEqual([true, true, true, false]);
  });
});
