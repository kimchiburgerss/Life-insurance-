/**
 * Phase 6 end to end (mock mode): signed agreement → claim packet (facts,
 * documents, AI review, assembly, OWNER approval, filing, State decision) →
 * payment to the heir → invoice (approval, send, reminders, payment) →
 * FEE_COLLECTED → CLOSED_WON. Plus the gates on packets and invoices.
 */
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockPaymentsProvider } from "@/adapters/payments/mock";
import { ForbiddenError } from "@/lib/auth/permissions";
import { transitionCase } from "@/lib/case/transitions";
import { blindIndex, encryptPii } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { addDays, addMonths, todayIn } from "@/lib/dates";
import type { Role } from "@/lib/generated/prisma/enums";
import { dispatchAgreement, simulateMockSignature } from "@/lib/agreements/gateway";
import { approveAgreement, createAgreement } from "@/lib/agreements/service";
import { dispatchInvoice, InvoiceSendRefused, sendDueReminders, simulateMockPayment, voidInvoice } from "@/lib/billing/gateway";
import { approveInvoice, BillingError, markPaidManually, recordHeirPayment } from "@/lib/billing/service";
import { approvePacket, assemblePacketFor, ClaimError, createPacket, packetContext, recordFiling, recordOutcome, setItemDecision, updatePacketFacts, uploadForClaimant } from "@/lib/claims/service";
import { reviewHeirDocument } from "@/lib/claims/review";
import { readFile } from "@/lib/files/storage";
import { saveBusinessProfile } from "@/lib/outreach/settings";
import { ensurePortalAccess, portalContextFromSecret, startPortalSession } from "@/lib/portal/access";
import { uploadDocument } from "@/lib/portal/service";
import { makeUser } from "../helpers/factories";

const today = todayIn();
let owner: { id: string; role: Role };
let researcher: { id: string; role: Role };
const RULES = ["WAITING_PERIOD", "FEE_CAP", "DISCLOSURE_TEXT", "AGREEMENT_REQUIREMENTS"] as const;
// 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function pdf(text: string): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 14, font: f });
  return d.save();
}

/** A case whose agreement is signed (through the real Phase 5 flow). */
async function signedCase(opts: { relationship?: "CHILD" | "SPOUSE"; amount?: number } = {}) {
  const tag = randomUUID().slice(0, 8);
  const o = await prisma.owner.create({ data: { fullName: `Ruth Claim${tag}`, normalizedName: `RUTH CLAIM${tag}`.toUpperCase(), dateOfDeath: new Date("2023-03-04T00:00:00Z") } });
  const c = await prisma.case.create({
    data: {
      ownerId: o.id,
      stage: "RESPONDED",
      properties: {
        create: [{ statePropertyId: `CLM-${tag}`, ownerNameRaw: `ESTATE OF RUTH CLAIM${tag}`, ownerId: o.id, category: "LIFE_INSURANCE", holderName: "SIERRA PINES FRATERNAL BENEFIT SOCIETY", reportedAmountCents: opts.amount ?? 1_000_000, dateDeliveredToState: addMonths(today, -30, "rollForward"), rawRecord: { t: 1 } }],
      },
    },
  });
  const ev = await prisma.evidence.create({ data: { caseId: c.id, sourceType: "OBITUARY", supportsDeath: true, title: "Obituary (test)" } });
  const email = `claim-${tag}@example.com`;
  const heir = await prisma.person.create({
    data: {
      caseId: c.id,
      fullName: `Casey Claim${tag}`,
      normalizedName: `CASEY CLAIM${tag}`.toUpperCase(),
      relationship: opts.relationship ?? "CHILD",
      relationshipConfidence: 0.9,
      status: "CONFIRMED",
      sourceEvidenceIds: [ev.id],
      mailingAddressEnc: encryptPii(`${Math.floor(Math.random() * 9000) + 100} Aspen Way, Elko, NV 89801`),
      emailEnc: encryptPii(email),
      emailHash: blindIndex(email),
    },
  });
  const a = await createAgreement(owner, { caseId: c.id, personId: heir.id });
  await approveAgreement(owner, a.id, { contentHash: a.contentHash!, confirmed: true, method: "ESIGN" });
  await dispatchAgreement(a.id);
  await simulateMockSignature(a.id, heir.id);
  const access = await ensurePortalAccess(prisma, { caseId: c.id, personId: heir.id });
  const portal = (await portalContextFromSecret((await startPortalSession(access.token))!.secret))!;
  return { c, heir, agreementId: a.id, portal };
}

async function acceptAll(caseId: string) {
  await prisma.heirDocument.updateMany({ where: { caseId }, data: { status: "ACCEPTED", reviewedById: owner.id, reviewedAt: new Date() } });
}

/** Signed case → approved, filed, State-approved claim. */
async function approvedClaim(opts: { amount?: number } = {}) {
  const s = await signedCase(opts);
  const packet = await createPacket(owner, { caseId: s.c.id, personId: s.heir.id });
  await updatePacketFacts(owner, packet.id, { estatePath: "SMALL_ESTATE", hasWill: false });
  for (const key of ["claimant_id", "death_certificate", "relationship_proof", "small_estate_affidavit", "affidavit_of_heirship"]) {
    await uploadDocument(s.portal, { checklistKey: key, fileName: `${key}.pdf`, bytes: await pdf(key) });
  }
  await uploadForClaimant(owner, packet.id, { checklistKey: "claim_form", fileName: "claim-form.pdf", bytes: await pdf("claim form, notarized") });
  await acceptAll(s.c.id);
  await assemblePacketFor(owner, packet.id);
  const ready = await prisma.claimPacket.findUniqueOrThrow({ where: { id: packet.id } });
  await approvePacket(owner, packet.id, { contentHash: ready.contentHash!, confirmed: true });
  await recordFiling(owner, packet.id, { filedOn: today, method: "ONLINE", claimNumber: `NV-${tag()}` });
  await recordOutcome(owner, packet.id, { outcome: "APPROVED", on: today, note: "" });
  return { ...s, packetId: packet.id };
}

const tag = () => randomUUID().slice(0, 6).toUpperCase();

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

describe("claim packet", () => {
  it("works out which documents apply from the estate facts and never drops one silently", async () => {
    const s = await signedCase();
    const packet = await createPacket(researcher, { caseId: s.c.id, personId: s.heir.id });
    let ctx = await packetContext(prisma, packet.id);
    const status = (k: string) => ctx.rows.find((r) => r.key === k)?.status;
    expect(status("small_estate_affidavit")).toBe("UNDECIDED");
    expect(status("probate_documents")).toBe("UNDECIDED");
    expect(status("spouse_small_estate_affidavit")).toBe("NOT_APPLICABLE"); // claimant is a child
    expect(status("release_of_heir")).toBe("NOT_APPLICABLE"); // only one heir
    expect(status("agreement_copy")).toBe("ACCEPTED"); // the signed agreement
    expect(ctx.readiness.ready).toBe(false);

    await updatePacketFacts(researcher, packet.id, { estatePath: "SMALL_ESTATE", hasWill: false });
    ctx = await packetContext(prisma, packet.id);
    expect(status("small_estate_affidavit")).toBe("MISSING");
    expect(status("affidavit_of_heirship")).toBe("MISSING");
    expect(status("will_or_trust")).toBe("NOT_APPLICABLE");
    expect(status("probate_documents")).toBe("NOT_APPLICABLE");
    expect(ctx.notarize).toBe(true); // $10,000 ≥ $500
    await expect(assemblePacketFor(owner, packet.id)).rejects.toThrow(/Not ready/);

    // A researcher can't waive a required document; the owner can, with a reason.
    await expect(setItemDecision(researcher, packet.id, { key: "affidavit_of_heirship", status: "WAIVED", reason: "test" })).rejects.toBeInstanceOf(ForbiddenError);
    await setItemDecision(owner, packet.id, { key: "affidavit_of_heirship", status: "WAIVED", reason: "Division confirmed by phone it isn't needed" });
    ctx = await packetContext(prisma, packet.id);
    expect(status("affidavit_of_heirship")).toBe("WAIVED");
  });

  it("assembles a cover letter plus the accepted documents (PDF and photo) into one PDF", async () => {
    const s = await signedCase();
    const packet = await createPacket(owner, { caseId: s.c.id, personId: s.heir.id });
    await updatePacketFacts(owner, packet.id, { estatePath: "PROBATE" });
    await uploadDocument(s.portal, { checklistKey: "claimant_id", fileName: "id.png", bytes: PNG });
    for (const key of ["death_certificate", "relationship_proof", "probate_documents"]) await uploadDocument(s.portal, { checklistKey: key, fileName: `${key}.pdf`, bytes: await pdf(key) });
    await uploadForClaimant(owner, packet.id, { checklistKey: "claim_form", fileName: "claim.pdf", bytes: await pdf("claim") });

    const docs = await prisma.heirDocument.findMany({ where: { caseId: s.c.id } });
    const review = await reviewHeirDocument(owner, docs.find((d) => d.checklistKey === "death_certificate")!.id);
    expect(review.review.issues[0]?.message).toMatch(/Demo mode/);
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: review.runId } })).inputRedacted).toMatchObject({ attachments: [{ kind: "pdf" }] });

    await acceptAll(s.c.id);
    const r = await assemblePacketFor(owner, packet.id);
    const p = await prisma.claimPacket.findUniqueOrThrow({ where: { id: packet.id } });
    expect(p.status).toBe("READY_FOR_REVIEW");
    expect(p.coverLetterText).toContain(s.heir.fullName);
    expect(p.coverLetterText).toContain("555 E Washington Ave");
    expect(p.coverLetterText).toContain("notarized");
    expect(p.coverLetterText).not.toMatch(/agreement/i); // our agreement stays in our file
    const file = await readFile(p.assembledPdfKey!);
    const merged = await PDFDocument.load(file!.bytes);
    expect(merged.getPageCount()).toBe(r.pages);
    expect(r.pages).toBeGreaterThanOrEqual(6); // cover + 5 enclosures
    expect((p.assembledFrom as { key: string }[]).map((x) => x.key)).toEqual(["claim_form", "claimant_id", "death_certificate", "relationship_proof", "probate_documents"]);
  });

  it("only the OWNER approves, only the assembled version, and approved packets can't change", async () => {
    const s = await approvedClaim();
    const c = await prisma.case.findUniqueOrThrow({ where: { id: s.c.id } });
    expect(c.stage).toBe("CLAIM_APPROVED");
    const packet = await prisma.claimPacket.findUniqueOrThrow({ where: { id: s.packetId } });
    expect(packet).toMatchObject({ status: "APPROVED_BY_STATE", filedMethod: "ONLINE", outcome: "APPROVED" });
    await expect(prisma.claimPacket.update({ where: { id: packet.id }, data: { assembledPdfKey: null } })).rejects.toThrow(/can no longer be changed/);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: packet.id }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["claim_packet.created", "claim_packet.assembled", "claim_packet.approved", "claim_packet.filed", "claim_packet.outcome"]));

    const other = await signedCase();
    const p2 = await createPacket(owner, { caseId: other.c.id, personId: other.heir.id });
    await expect(prisma.claimPacket.update({ where: { id: p2.id }, data: { status: "FILED" } })).rejects.toThrow(/without an approval/);
    await expect(approvePacket(owner, p2.id, { contentHash: "x", confirmed: true })).rejects.toBeInstanceOf(ClaimError);
  });

  it("a denial returns the case for a new packet; more-info leads to a re-filing", async () => {
    const s = await signedCase();
    const packet = await createPacket(owner, { caseId: s.c.id, personId: s.heir.id });
    await updatePacketFacts(owner, packet.id, { estatePath: "PROBATE" });
    for (const key of ["claimant_id", "death_certificate", "relationship_proof", "probate_documents"]) await uploadDocument(s.portal, { checklistKey: key, fileName: `${key}.pdf`, bytes: await pdf(key) });
    await uploadForClaimant(owner, packet.id, { checklistKey: "claim_form", fileName: "c.pdf", bytes: await pdf("c") });
    await acceptAll(s.c.id);
    await assemblePacketFor(owner, packet.id);
    await approvePacket(owner, packet.id, { contentHash: (await prisma.claimPacket.findUniqueOrThrow({ where: { id: packet.id } })).contentHash!, confirmed: true });
    await recordFiling(owner, packet.id, { filedOn: today, method: "MAIL", claimNumber: "" });
    await expect(recordOutcome(owner, packet.id, { outcome: "MORE_INFO", on: today, note: "" })).rejects.toThrow(/Note what the State said/);
    await recordOutcome(owner, packet.id, { outcome: "MORE_INFO", on: today, note: "Needs certified copy of letters" });
    expect((await prisma.case.findUniqueOrThrow({ where: { id: s.c.id } })).stage).toBe("MORE_INFO_REQUESTED");
  });
});

describe("billing", () => {
  it("fee = agreement % of what the heir actually received; invoice approved, sent, reminded, paid; case closes as won", async () => {
    const s = await approvedClaim();
    const inv = await recordHeirPayment(owner, { agreementId: s.agreementId, amountPaidCents: 987_655, paidOn: today, evidence: "Heir emailed the State's payment letter" });
    expect(inv).toMatchObject({ status: "DRAFT", amountPaidToHeirCents: 987_655, feeBps: 1000, amountCents: 98_765 }); // rounded down
    expect((await prisma.case.findUniqueOrThrow({ where: { id: s.c.id } })).stage).toBe("PAID_TO_HEIR");
    await expect(recordHeirPayment(owner, { agreementId: s.agreementId, amountPaidCents: 1, paidOn: today, evidence: "again!" })).rejects.toThrow(/already has an invoice/);

    await expect(dispatchInvoice(inv.id)).rejects.toBeInstanceOf(InvoiceSendRefused); // not approved
    await expect(prisma.invoice.update({ where: { id: inv.id }, data: { status: "OPEN" } })).rejects.toThrow(/without an approval/);
    await expect(approveInvoice(researcher, inv.id, { contentHash: inv.contentHash!, confirmed: true, method: "STRIPE" })).rejects.toBeInstanceOf(ForbiddenError);
    await approveInvoice(owner, inv.id, { contentHash: inv.contentHash!, confirmed: true, method: "STRIPE" });
    await expect(prisma.invoice.update({ where: { id: inv.id }, data: { amountCents: 1 } })).rejects.toThrow(/can no longer be changed/);

    expect(await dispatchInvoice(inv.id)).toEqual({ status: "SENT", method: "STRIPE" });
    const sent = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(sent).toMatchObject({ status: "OPEN", provider: "mock-payments" });
    expect(MockPaymentsProvider.store.get(sent.stripeInvoiceId!)?.req.amountCents).toBe(98_765);
    expect((await prisma.case.findUniqueOrThrow({ where: { id: s.c.id } })).stage).toBe("FEE_INVOICED");

    // Reminders at 7 / 14 / 30 days, once each.
    await sendDueReminders(addDays(today, 8));
    await sendDueReminders(addDays(today, 8));
    expect(MockPaymentsProvider.store.get(sent.stripeInvoiceId!)?.reminders).toBe(1);
    await sendDueReminders(addDays(today, 31));
    const reminded = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect((reminded.remindersSent as { day: number }[]).map((r) => r.day)).toEqual([7, 14, 30]);
    expect(MockPaymentsProvider.store.get(sent.stripeInvoiceId!)?.reminders).toBe(2);

    await simulateMockPayment(inv.id, s.heir.id);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    expect((await prisma.case.findUniqueOrThrow({ where: { id: s.c.id } })).stage).toBe("FEE_COLLECTED");
    await transitionCase({ caseId: s.c.id, to: "CLOSED_WON", actor: { type: "USER", id: owner.id, role: "OWNER" } });
    expect((await prisma.case.findUniqueOrThrow({ where: { id: s.c.id } })).stage).toBe("CLOSED_WON");
  });

  it("manual invoices, voiding, and refusing nonsense", async () => {
    const s = await approvedClaim();
    await expect(recordHeirPayment(owner, { agreementId: s.agreementId, amountPaidCents: 0, paidOn: today, evidence: "x" })).rejects.toBeInstanceOf(BillingError);
    await expect(recordHeirPayment(owner, { agreementId: s.agreementId, amountPaidCents: 100, paidOn: addDays(today, 2), evidence: "future date" })).rejects.toThrow(/future/);
    await expect(recordHeirPayment(researcher, { agreementId: s.agreementId, amountPaidCents: 100, paidOn: today, evidence: "researcher" })).rejects.toBeInstanceOf(ForbiddenError);
    const inv = await recordHeirPayment(owner, { agreementId: s.agreementId, amountPaidCents: 500_000, paidOn: today, evidence: "State confirmation letter" });
    await approveInvoice(owner, inv.id, { contentHash: inv.contentHash!, confirmed: true, method: "MANUAL" });
    expect(await dispatchInvoice(inv.id)).toEqual({ status: "SENT", method: "MANUAL" });
    await markPaidManually(owner, inv.id, { paidOn: today, note: "check #1042" });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    await expect(voidInvoice(owner, inv.id, "mistake here")).rejects.toThrow(/can't be voided/);
  });

  it("an open online invoice can be voided (withdrawn at Stripe)", async () => {
    const s = await approvedClaim();
    const inv = await recordHeirPayment(owner, { agreementId: s.agreementId, amountPaidCents: 200_000, paidOn: today, evidence: "Heir confirmed by phone" });
    await approveInvoice(owner, inv.id, { contentHash: inv.contentHash!, confirmed: true, method: "STRIPE" });
    await dispatchInvoice(inv.id);
    await voidInvoice(owner, inv.id, "Heir disputes the amount");
    const v = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(v.status).toBe("VOID");
    expect(MockPaymentsProvider.store.get(v.stripeInvoiceId!)?.voided).toBe(true);

    // A voided invoice can be replaced with the corrected figures; a second live one cannot.
    const fixed = await recordHeirPayment(owner, { agreementId: s.agreementId, amountPaidCents: 150_000, paidOn: today, evidence: "Corrected: State letter shows $1,500" });
    expect(fixed.amountCents).toBe(15_000);
    await expect(recordHeirPayment(owner, { agreementId: s.agreementId, amountPaidCents: 150_000, paidOn: today, evidence: "duplicate entry" })).rejects.toThrow(/already has an invoice/);
    await expect(prisma.invoice.create({ data: { caseId: s.c.id, agreementId: s.agreementId, amountCents: 1 } })).rejects.toThrow(/Unique constraint/);
  });
});
