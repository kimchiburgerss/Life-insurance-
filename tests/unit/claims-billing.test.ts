import { createHmac, randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { parseStripeEvent, verifyStripeSignature } from "@/adapters/payments/webhook";
import { feeOnPayment, invoiceHash } from "@/lib/billing/service";
import { assemblePacket, AssemblyError } from "@/lib/claims/assemble";
import { applicability, buildPacketChecklist, packetContents, packetReadiness, type PacketFacts } from "@/lib/claims/checklist";
import { consistencyFlags, nameSimilarity, type DocumentReview } from "@/lib/claims/review";
import { NEVADA_RULES } from "@/lib/rules/jurisdictions";
import type { ClaimRequirementsParams } from "@/lib/rules/schemas";
import { FeeCapExceededError } from "@/lib/rules/engine";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY ??= randomBytes(32).toString("base64");
});

const V3 = NEVADA_RULES.find((r) => r.ruleType === "CLAIM_REQUIREMENTS" && r.version === 3)!.params as ClaimRequirementsParams;
const facts = (over: Partial<PacketFacts> = {}): PacketFacts => ({ estatePath: null, hasWill: null, spouseClaimant: false, multipleHeirs: false, ...over });
const item = (key: string) => V3.checklist.find((i) => i.key === key)!;

describe("claim checklist (CLAIM_REQUIREMENTS v3)", () => {
  it("picks the Treasurer's forms from the estate facts", () => {
    const small = facts({ estatePath: "SMALL_ESTATE", hasWill: false });
    expect(applicability(item("small_estate_affidavit"), small).applies).toBe(true); // UP-45
    expect(applicability(item("spouse_small_estate_affidavit"), small).applies).toBe(false); // UP-47 only for a spouse
    expect(applicability(item("affidavit_of_heirship"), small).applies).toBe(true); // UP-40, no will
    expect(applicability(item("will_or_trust"), small).applies).toBe(false);
    expect(applicability(item("probate_documents"), small).applies).toBe(false);
    const spouse = facts({ estatePath: "SMALL_ESTATE", hasWill: true, spouseClaimant: true });
    expect(applicability(item("spouse_small_estate_affidavit"), spouse).applies).toBe(true);
    expect(applicability(item("small_estate_affidavit"), spouse).applies).toBe(false);
    expect(applicability(item("will_or_trust"), spouse).applies).toBe(true);
    expect(applicability(item("probate_documents"), facts({ estatePath: "PROBATE" })).applies).toBe(true);
    expect(applicability(item("release_of_heir"), facts({ multipleHeirs: true })).applies).toBe(true); // UP-43
  });

  it("unknown facts keep conditional documents visible instead of dropping them", () => {
    expect(applicability(item("small_estate_affidavit"), facts()).applies).toBe("UNKNOWN");
    const rows = buildPacketChecklist({ items: V3.checklist, facts: facts(), documents: [], decisions: [], signedAgreementFileId: "f1" });
    expect(rows.find((r) => r.key === "probate_documents")?.status).toBe("UNDECIDED");
    expect(packetReadiness(rows).blockers.some((b) => /confirm the estate facts/.test(b))).toBe(true);
  });

  it("is ready only when every needed document is accepted or waived; our agreement never goes in the packet", () => {
    const f = facts({ estatePath: "PROBATE" });
    const keys = ["claim_form", "claimant_id", "death_certificate", "relationship_proof", "probate_documents"];
    const docs = keys.map((k, i) => ({ documentId: `d${i}`, key: k, fileId: `f${i}`, fileName: `${k}.pdf`, contentType: "application/pdf", status: "ACCEPTED" as const, uploadedAt: "2026-11-26" }));
    const rows = buildPacketChecklist({ items: V3.checklist, facts: f, documents: docs, decisions: [], signedAgreementFileId: "agr" });
    expect(packetReadiness(rows)).toEqual({ ready: true, blockers: [] });
    expect(packetContents(rows).map((c) => c.key)).toEqual(keys);
    const missingOne = buildPacketChecklist({ items: V3.checklist, facts: f, documents: docs.slice(1), decisions: [], signedAgreementFileId: "agr" });
    expect(packetReadiness(missingOne).ready).toBe(false);
    const waived = buildPacketChecklist({ items: V3.checklist, facts: f, documents: docs.slice(1), decisions: [{ key: "claim_form", status: "WAIVED", reason: "Filed online" }], signedAgreementFileId: "agr" });
    expect(packetReadiness(waived).ready).toBe(true);
  });
});

describe("AI document review consistency checks", () => {
  const review = (over: Partial<DocumentReview> = {}): DocumentReview => ({
    documentType: "Nevada certificate of death",
    matchesExpectedType: true,
    legible: true,
    namesFound: [{ name: "DOE, MARGARET ANN", role: "decedent" }],
    datesFound: [{ date: "2023-03-04", what: "date of death" }],
    signedAndNotarized: null,
    issues: [],
    summary: "",
    ...over,
  });
  const caseFacts = { ownerName: "Margaret A. Doe", ownerDateOfDeath: "2023-03-04", claimantName: "Jordan Doe", checklistKey: "death_certificate" };

  it("matches names regardless of order and middle names", () => {
    expect(nameSimilarity("DOE, MARGARET ANN", "Margaret A. Doe")).toBeGreaterThan(0.85);
    expect(nameSimilarity("Robert Smith", "Margaret A. Doe")).toBeLessThan(0.85); // the app flags below 0.85
  });
  it("passes a matching death certificate", () => {
    expect(consistencyFlags(review(), caseFacts)).toEqual([]);
  });
  it("flags a different decedent, a different date of death, the wrong document, or an unreadable copy", () => {
    expect(consistencyFlags(review({ namesFound: [{ name: "ROBERT SMITH", role: "decedent" }] }), caseFacts)[0]?.message).toMatch(/does not match/);
    expect(consistencyFlags(review({ datesFound: [{ date: "2022-01-01", what: "date of death" }] }), caseFacts)[0]?.message).toMatch(/differs/);
    expect(consistencyFlags(review({ matchesExpectedType: false, documentType: "utility bill" }), caseFacts)[0]?.severity).toBe("high");
    expect(consistencyFlags(review({ legible: false }), caseFacts).some((f) => /not readable/.test(f.message))).toBe(true);
  });
  it("requires notarization on affidavits and the claimant's name on the ID", () => {
    expect(consistencyFlags(review({ signedAndNotarized: false, namesFound: [] }), { ...caseFacts, checklistKey: "small_estate_affidavit" }).some((f) => /notarized/.test(f.message))).toBe(true);
    expect(consistencyFlags(review({ namesFound: [{ name: "Someone Else", role: "license holder" }] }), { ...caseFacts, checklistKey: "claimant_id" })[0]?.message).toMatch(/claimant's name/);
  });
});

describe("fees and invoices", () => {
  it("fee is the agreement percentage of what the heir received, rounded down", () => {
    expect(feeOnPayment(987_655, { feeBps: 1000, feeCapBps: 1000 })).toBe(98_765);
    expect(feeOnPayment(1_000_000, { feeBps: 2000, feeCapBps: 2000 })).toBe(200_000);
  });
  it("refuses a fee above the agreement's cap", () => {
    expect(() => feeOnPayment(100_000, { feeBps: 2000, feeCapBps: 1000 })).toThrow(FeeCapExceededError);
  });
  it("the approved hash covers recipient, amount and text", () => {
    const base = { recipient: { name: "A", email: "a@example.com" }, amountCents: 100, currency: "usd", description: "fee", agreementId: "agr" };
    const h = invoiceHash(base);
    expect(invoiceHash({ ...base, amountCents: 101 })).not.toBe(h);
    expect(invoiceHash({ ...base, recipient: { name: "A", email: "b@example.com" } })).not.toBe(h);
    expect(invoiceHash({ ...base, recipient: { name: "A", email: "A@EXAMPLE.COM" } })).toBe(h);
  });
});

describe("Stripe webhooks", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", created: 1764158400, data: { object: { id: "in_1", object: "invoice", metadata: { invoice_id: "inv_1" }, status_transitions: { paid_at: 1764158500 } } } });
  const now = 1764158400 * 1000;
  const sig = (t: number, payload = body, key = secret) => `t=${t},v1=${createHmac("sha256", key).update(`${t}.${payload}`).digest("hex")}`;
  it("accepts a valid signature (any v1 during secret rotation)", () => {
    expect(verifyStripeSignature(body, sig(1764158400), secret, now)).toBe(true);
    expect(verifyStripeSignature(body, `${sig(1764158400, body, "old")},v1=${sig(1764158400).split("v1=")[1]}`, secret, now)).toBe(true);
  });
  it("rejects tampering, wrong secrets, missing headers and old timestamps", () => {
    expect(verifyStripeSignature(body.replace("in_1", "in_2"), sig(1764158400), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, sig(1764158400, body, "other"), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, null, secret, now)).toBe(false);
    expect(verifyStripeSignature(body, sig(1764158400 - 600), secret, now)).toBe(false);
  });
  it("maps invoice events", () => {
    expect(parseStripeEvent(JSON.parse(body))).toMatchObject({ eventId: "evt_1", type: "PAID", providerInvoiceId: "in_1", invoiceId: "inv_1" });
    expect(parseStripeEvent({ id: "evt_2", type: "customer.created", data: { object: { object: "customer" } } })?.type).toBe("OTHER");
  });
});

describe("packet assembly", () => {
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  async function pdf(pages: number) {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) d.addPage([612, 792]).drawText(`page ${i + 1}`, { x: 72, y: 700, size: 12, font: f });
    return d.save();
  }
  it("puts the cover letter first, then every page of every document, photos as pages", async () => {
    const r = await assemblePacket({
      coverMarkdown: "# Claim for unclaimed property\n\nEnclosed documents follow.",
      reference: "NV-000001-C",
      createdAt: new Date("2026-11-26T00:00:00Z"),
      enclosures: [
        { key: "death_certificate", label: "Death certificate", fileName: "dc.pdf", contentType: "application/pdf", bytes: await pdf(2) },
        { key: "claimant_id", label: "Photo ID", fileName: "id.png", contentType: "image/png", bytes: PNG },
      ],
    });
    expect(r.pages).toBe(1 + 2 + 1);
    expect(r.manifest.map((m) => m.pages)).toEqual([2, 1]);
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(4);
  });
  it("refuses formats that can't go into a PDF, and broken PDFs", async () => {
    await expect(assemblePacket({ coverMarkdown: "# x", reference: "r", createdAt: new Date(), enclosures: [{ key: "k", label: "L", fileName: "a.heic", contentType: "image/heic", bytes: new Uint8Array(20) }] })).rejects.toBeInstanceOf(AssemblyError);
    await expect(assemblePacket({ coverMarkdown: "# x", reference: "r", createdAt: new Date(), enclosures: [{ key: "k", label: "L", fileName: "b.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4 broken") }] })).rejects.toThrow(/could not be opened/);
  });
});
