import { createHmac, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { buildAgreementChecklist, type AgreementFacts } from "@/lib/agreements/checklist";
import { AgreementContentError, agreementVariables, escapeMd, fillTemplate, propertyListMarkdown, totalValueCents, type AgreementProperty } from "@/lib/agreements/content";
import { AgreementPdfError, assertPrintable, renderAgreementPdf } from "@/lib/agreements/pdf";
import { DRAFT_NOTICE, loadDraftAgreementTemplate, validateAgreementTemplate } from "@/lib/agreements/template";
import { NEVADA_RULES } from "@/lib/rules/jurisdictions";
import { DROPBOX_SIGN_ACK, parseDropboxSignEvent, verifyDropboxSignEvent } from "@/adapters/esign/webhook";
import { safeFileName, sniffFileType } from "@/lib/files/sniff";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY ??= randomBytes(32).toString("base64");
});

const REQUIRED = (NEVADA_RULES.find((r) => r.ruleType === "AGREEMENT_REQUIREMENTS")!.params as { requiredFields: string[] }).requiredFields;
const DISCLOSURE =
  "You can claim this property yourself, for free, directly from the Nevada State Treasurer's Office, Unclaimed Property Division at https://claims.nevadaunclaimedproperty.gov. You do not need to use our service or pay anyone to file a claim.";

const prop = (over: Partial<AgreementProperty> = {}): AgreementProperty => ({
  statePropertyId: "NV-1",
  category: "LIFE_INSURANCE",
  holderName: "SILVER SAGE MUTUAL LIFE INSURANCE CO",
  reportedAmountCents: 482_219,
  amountIsMinimum: false,
  dateDeliveredToState: new Date("2024-05-26T00:00:00Z"),
  ...over,
});

function facts(over: Partial<Parameters<typeof agreementVariables>[0]> = {}) {
  return {
    agreementDate: new Date("2026-11-26T00:00:00Z"),
    business: { name: "Sample Recovery LLC", address: "100 W Liberty St, Reno, NV 89501", contactName: "Pat Rivera" },
    heir: { name: "Riley O'Neil", address: "12 Oak St, Las Vegas, NV 89101" },
    ownerName: "Evelyn Q. Example",
    properties: [prop()],
    disclosure: { text: DISCLOSURE, claimWebsite: "https://claims.nevadaunclaimedproperty.gov" },
    feeBps: 1000,
    feeCapBps: 1000,
    cancellationDays: 10,
    governingLaw: "[Governing law — to be completed by your attorney.]",
    ...over,
  };
}

describe("agreement template (spec 5.7, rule 3)", () => {
  it("the shipped draft contains every term the Nevada AGREEMENT_REQUIREMENTS rule requires", () => {
    expect(validateAgreementTemplate(loadDraftAgreementTemplate().body, REQUIRED)).toEqual([]);
  });

  it("refuses a template missing the disclosure, the values or the services section", () => {
    const body = loadDraftAgreementTemplate().body;
    expect(validateAgreementTemplate(body.replace("{{disclosure}}", ""), REQUIRED)).toContain("Missing: Free-claim disclosure");
    expect(validateAgreementTemplate(body.replaceAll("{{valueAfterFee}}", "x"), REQUIRED)).toContain("Missing: Value of the property after the fee");
    expect(validateAgreementTemplate(body.replace("## 4. Our services", "## 4. What we do"), REQUIRED)).toContain("Missing: Description of our services");
    expect(validateAgreementTemplate(`${body}\n{{secret}}`, REQUIRED)).toContain("Unknown variable {{secret}}");
    expect(validateAgreementTemplate(`${body}\n<script>`, REQUIRED)).toContain("HTML is not allowed in the agreement template");
  });
});

describe("agreement content", () => {
  it("states exact values before and after the fee, rounding the fee down (heir's favour)", () => {
    const built = agreementVariables(facts({ properties: [prop({ reportedAmountCents: 99_999 })] }));
    expect(built.valueBeforeFeeCents).toBe(99_999);
    expect(built.feeCents).toBe(9_999);
    expect(built.valueAfterFeeCents).toBe(90_000);
    expect(built.vars.feePercent).toBe("10%");
  });

  it("refuses inexact or unknown amounts and missing delivery dates (rule 3, rule 1)", () => {
    expect(() => totalValueCents([prop({ reportedAmountCents: null })])).toThrow(AgreementContentError);
    expect(() => totalValueCents([prop({ amountIsMinimum: true })])).toThrow(/exact amount is not known/);
    expect(() => totalValueCents([prop({ dateDeliveredToState: null })])).toThrow(/delivery date/);
  });

  it("escapes values so names can't add Markdown structure", () => {
    expect(escapeMd("**Bold** _x_ [link](y)")).toBe("\\*\\*Bold\\*\\* \\_x\\_ \\[link\\]\\(y\\)");
    expect(propertyListMarkdown([prop({ statePropertyId: "NV_1*" })])).toContain("NV\\_1\\*");
  });

  it("fills every variable or refuses", () => {
    const { vars } = agreementVariables(facts());
    const md = fillTemplate(loadDraftAgreementTemplate().body, vars);
    expect(md).not.toMatch(/\{\{/);
    expect(() => fillTemplate("{{nope}}", vars)).toThrow(/Unknown variable/);
  });
});

describe("agreement PDF", () => {
  async function render(draft: boolean, heirName = "Riley O'Neil") {
    const f = facts({ heir: { name: heirName, address: "12 Oak St, Las Vegas, NV 89101" } });
    const { vars } = agreementVariables(f);
    return renderAgreementPdf({
      title: "Recovery Services Agreement",
      markdown: fillTemplate(loadDraftAgreementTemplate().body, vars),
      draft,
      reference: "NV-000001-A1",
      createdAt: new Date("2026-11-26T12:00:00Z"),
      signature: { businessName: "Sample Recovery LLC", businessSigner: "Pat Rivera", businessSignerTitle: "Owner", businessSignedDate: "November 26, 2026", heirName },
    });
  }

  it("renders a PDF whose text has every required term, the disclosure and both signature blocks", async () => {
    const r = await render(true);
    expect(Buffer.from(r.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(r.pages).toBeGreaterThanOrEqual(1);
    const flat = r.text.replace(/\s+/g, " ");
    for (const s of [DISCLOSURE, "$4,822.19", "$482.21", "$4,339.98", "10%", "May 26, 2024", "within 10 days", "Riley O'Neil (you)", "For Sample Recovery LLC", "/s/ Pat Rivera"]) {
      expect(flat).toContain(s);
    }
  });

  it("marks every draft 'DRAFT — must be reviewed by a licensed attorney before use', and not an approved one", async () => {
    expect((await render(true)).text).toContain(DRAFT_NOTICE);
    expect((await render(false)).text).not.toContain("DRAFT");
  });

  it("refuses names the PDF font can't print instead of silently dropping letters", async () => {
    await expect(render(true, "李 Wei")).rejects.toBeInstanceOf(AgreementPdfError);
    expect(() => assertPrintable("Name", "José Muñoz-O'Brien")).not.toThrow();
  });
});

describe("agreement checklist", () => {
  const base: AgreementFacts = {
    eligibility: { status: "ELIGIBLE", eligibleContractDate: new Date("2026-01-01T00:00:00Z") },
    unverifiedRules: [],
    caseStage: "RESPONDED",
    feeBps: 1000,
    feeCapBps: 1000,
    amountsExact: true,
    missingRequired: [],
    disclosureInText: true,
    signer: { name: "Riley", email: "r@example.com", rejected: false, predeceased: false, doNotContact: false },
    attorneyApproved: false,
    mockMode: true,
    esignConfigured: { ok: true, name: "mock" },
    otherActiveAgreement: false,
  };
  const status = (patch: Partial<AgreementFacts>, key: string) => buildAgreementChecklist({ ...base, ...patch }).find((i) => i.key === key)?.status;

  it("passes with the DRAFT text only as a warning in demo mode", () => {
    expect(buildAgreementChecklist(base).filter((i) => i.status === "fail")).toEqual([]);
    expect(status({}, "attorney")).toBe("warn");
    expect(status({ mockMode: false }, "attorney")).toBe("fail");
  });
  it.each<[string, Partial<AgreementFacts>]>([
    ["void_period", { eligibility: { status: "WAITING", eligibleContractDate: new Date("2027-01-01T00:00:00Z"), daysRemaining: 10 } }],
    ["fee_cap", { feeBps: 2000 }],
    ["fee_cap", { feeCapBps: null }],
    ["amounts", { amountsExact: false }],
    ["required_fields", { missingRequired: ["Free-claim disclosure"] }],
    ["disclosure", { disclosureInText: false }],
    ["signer", { signer: { ...base.signer, doNotContact: true } }],
    ["case_stage", { caseStage: "CONTACTED" }],
    ["rules_verified", { unverifiedRules: ["AGREEMENT_REQUIREMENTS"] }],
    ["one_agreement", { otherActiveAgreement: true }],
  ])("fails %s", (key, patch) => {
    expect(status(patch, key)).toBe("fail");
  });
  it("a missing email only warns (paper signing still works)", () => {
    expect(status({ signer: { ...base.signer, email: null } }, "signer_email")).toBe("warn");
  });
});

describe("Dropbox Sign callbacks", () => {
  const apiKey = "test-api-key";
  const event = (type: string, time = "1764158400") => ({
    event: { event_time: time, event_type: type, event_hash: createHmac("sha256", apiKey).update(`${time}${type}`).digest("hex") },
    signature_request: { signature_request_id: "sr_1", metadata: { agreement_id: "agr_1" } },
  });
  it("accepts a correctly hashed event and maps its type", () => {
    const e = event("signature_request_all_signed");
    expect(verifyDropboxSignEvent(e, apiKey)).toBe(true);
    expect(parseDropboxSignEvent(e)).toMatchObject({ type: "ALL_SIGNED", requestId: "sr_1", agreementId: "agr_1" });
    expect(DROPBOX_SIGN_ACK).toBe("Hello API Event Received");
  });
  it("rejects a forged or altered event", () => {
    const e = event("signature_request_declined");
    expect(verifyDropboxSignEvent({ ...e, event: { ...e.event, event_type: "signature_request_all_signed" } }, apiKey)).toBe(false);
    expect(verifyDropboxSignEvent(e, "other-key")).toBe(false);
    expect(verifyDropboxSignEvent({ event: { event_type: "x" } }, apiKey)).toBe(false);
  });
});

describe("uploaded file checks", () => {
  const head = (s: string, pad = 16) => new Uint8Array([...Buffer.from(s, "latin1"), ...new Uint8Array(pad)]);
  it("identifies PDFs and phone photos by their bytes, not their names", () => {
    expect(sniffFileType(head("%PDF-1.7\n"))?.contentType).toBe("application/pdf");
    expect(sniffFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Uint8Array(12)]))?.contentType).toBe("image/jpeg");
    expect(sniffFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Uint8Array(8)]))?.contentType).toBe("image/png");
    expect(sniffFileType(head("\0\0\0\x18ftypheic"))?.contentType).toBe("image/heic");
    expect(sniffFileType(head("RIFF\0\0\0\0WEBPVP8 "))?.contentType).toBe("image/webp");
  });
  it("refuses HTML, scripts and executables", () => {
    expect(sniffFileType(head("<html><script>"))).toBeNull();
    expect(sniffFileType(head("MZ\x90\0"))).toBeNull();
    expect(sniffFileType(head("#!/bin/sh"))).toBeNull();
  });
  it("cleans file names", () => {
    expect(safeFileName("../../etc/passwd", "pdf")).toBe("passwd.pdf");
    expect(safeFileName("Death cert <final>.exe", "jpg")).toBe("Death cert _final_.jpg");
  });
});

describe("file encryption and signed URLs", async () => {
  const { encryptBytes, decryptBytes } = await import("@/lib/files/crypto");
  const { signedFileUrl, verifyFileSignature } = await import("@/lib/files/storage");
  it("round-trips, and tampering is detected", () => {
    const plain = new TextEncoder().encode("%PDF-1.7 secret death certificate");
    const enc = encryptBytes(plain);
    expect(enc.includes(Buffer.from("secret"))).toBe(false);
    expect(Buffer.from(decryptBytes(enc)).toString()).toBe("%PDF-1.7 secret death certificate");
    enc[enc.length - 1] ^= 1;
    expect(() => decryptBytes(enc)).toThrow();
  });
  it("signed URLs expire and can't be moved to another file", () => {
    const now = Date.UTC(2026, 10, 26);
    const url = new URL(`http://x${signedFileUrl("file_1", { ttlSeconds: 600, now })}`);
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    expect(verifyFileSignature("file_1", exp, sig, now)).toBe(true);
    expect(verifyFileSignature("file_2", exp, sig, now)).toBe(false);
    expect(verifyFileSignature("file_1", exp, sig, now + 601_000)).toBe(false);
    expect(verifyFileSignature("file_1", String(Number(exp) + 3600), sig, now)).toBe(false);
  });
});
