import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mockPersonalization, mockToneCheck, tonePassed } from "@/lib/outreach/ai";
import { buildChecklist, checklistPasses, type ChecklistFacts } from "@/lib/outreach/checklist";
import { amountStatement, feeSentence, formatExactUsd, privateCompanyStatement, propertySummary } from "@/lib/outreach/content";
import { lintOutreach, readability, READING_GRADE_TARGET } from "@/lib/outreach/lint";
import { contentHashOf, escapeMarkdownValue, htmlToText, renderMessage, RenderError, type Recipient } from "@/lib/outreach/render";
import type { BusinessProfile } from "@/lib/outreach/settings";
import { FAQ_INSERT_ID, getTemplate, loadTemplates, parseTemplate, REQUIRED_ELEMENTS, TEMPLATE_VARIABLES, validateTemplate, type TemplateVariable } from "@/lib/outreach/templates";
import { isOptOutToken, newOptOutToken } from "@/lib/outreach/util";
import { interpretLobEvent, parseLobEvent, verifyLobSignature } from "@/lib/outreach/webhooks";

const DISCLOSURE =
  "You can claim this property yourself, for free, directly from the Nevada State Treasurer's Office, Unclaimed Property Division at https://claims.nevadaunclaimedproperty.gov. You do not need to use our service or pay anyone to file a claim.";
const PRIVATE = privateCompanyStatement("NV");

const business: BusinessProfile = {
  legalName: "Sample Recovery LLC",
  contactName: "Pat Rivera",
  contactTitle: "Owner",
  mailingAddress: { line1: "100 W Liberty St", line2: "Suite 500", city: "Reno", state: "NV", zip: "89501" },
  phone: "775-555-0100",
  email: "pat@example.com",
  website: "",
};

function vars(over: Partial<Record<TemplateVariable, string>> = {}): Record<TemplateVariable, string> {
  return {
    heirName: "Jordan Delacroix",
    ownerName: "Margaret A. Delacroix",
    personalNote: "We were sorry to learn of the passing of your parent, Margaret A. Delacroix.",
    propertySummary: propertySummary([{ category: "LIFE_INSURANCE", holderName: "ACME LIFE INSURANCE CO", reportedAmountCents: 1234567, amountIsMinimum: false }]),
    amountSentence: amountStatement([{ category: "LIFE_INSURANCE", holderName: null, reportedAmountCents: 1234567, amountIsMinimum: false }]).sentence,
    feeSentence: feeSentence(1000),
    disclosure: DISCLOSURE,
    privateCompany: PRIVATE,
    claimWebsite: "https://claims.nevadaunclaimedproperty.gov",
    contactName: business.contactName,
    contactTitleLine: ", Owner",
    businessName: business.legalName,
    businessPhone: business.phone,
    businessEmail: business.email,
    caseRef: "NV-000042",
    optOutUrl: "https://app.example.com/u/abcdefghjkmnpqrs",
    firstLetterDate: "October 1, 2026",
    ...over,
  };
}

const mail: Recipient = { kind: "MAIL", name: "Jordan Delacroix", address: { line1: "12 OAK ST", line2: "", city: "LAS VEGAS", state: "NV", zip: "89101" } };
const email: Recipient = { kind: "EMAIL", name: "Jordan Delacroix", email: "jordan@example.com" };

function render(templateId: string, v = vars()) {
  const t = getTemplate(templateId);
  return renderMessage({
    template: t,
    faqInsert: getTemplate(FAQ_INSERT_ID),
    vars: v,
    business,
    recipient: t.channel === "MAIL" ? mail : email,
    letterDate: "November 26, 2026",
  });
}

const MESSAGE_TEMPLATES = loadTemplates().filter((t) => t.channel !== "INSERT");

describe("outreach templates (spec 5.6)", () => {
  it("ships first, day-21 and day-45 messages for mail and email, plus the FAQ insert", () => {
    const keys = MESSAGE_TEMPLATES.map((t) => `${t.channel}:${t.step}`).sort();
    expect(keys).toEqual(["EMAIL:1", "EMAIL:2", "EMAIL:3", "MAIL:1", "MAIL:2", "MAIL:3"]);
    expect(getTemplate(FAQ_INSERT_ID).channel).toBe("INSERT");
  });

  it.each(MESSAGE_TEMPLATES.map((t) => [t.id, t] as const))("%s contains every required element", (_id, t) => {
    expect(validateTemplate(t)).toEqual([]);
    for (const el of REQUIRED_ELEMENTS) expect(el.test(t), el.label).toBe(true);
  });

  it("rejects a template missing the free-claim disclosure or using an unknown variable", () => {
    const t = parseTemplate("---\nid: x\nversion: 1\nchannel: MAIL\nstep: 1\ntitle: X\n---\nHello {{heirName}} {{secretField}}");
    const problems = validateTemplate(t);
    expect(problems).toContain("Unknown variable {{secretField}}");
    expect(problems.some((p) => p.includes("Free claim"))).toBe(true);
  });

  it.each(MESSAGE_TEMPLATES.map((t) => [t.id] as const))("%s renders with the disclosure and private-company line verbatim, in HTML and text", (id) => {
    const r = render(id);
    const flatHtml = htmlToText(r.html).replace(/\s+/g, " ");
    const flatText = r.text.replace(/\s+/g, " ");
    for (const s of [DISCLOSURE, PRIVATE]) {
      expect(flatHtml).toContain(s);
      expect(flatText).toContain(s);
    }
    expect(flatText).toContain("public records");
    expect(flatText).toContain("775-555-0100");
    expect(flatText).toContain("10%");
    expect(flatText).toContain("$12,345.67");
  });

  it.each(MESSAGE_TEMPLATES.map((t) => [t.id] as const))("%s passes the banned-terms lint, the mock tone check and the reading-level target", (id) => {
    const r = render(id);
    const findings = lintOutreach(`${r.subject ?? ""}\n${r.text}`, { requiredStatements: [DISCLOSURE, PRIVATE], allowedAmountsCents: [1234567] });
    expect(findings).toEqual([]);
    const tone = mockToneCheck({ channel: "MAIL", subject: r.subject, text: r.text, requiredStatements: [DISCLOSURE, PRIVATE] });
    expect(tonePassed(tone)).toBe(true);
    const body = r.text.split("\n\n---\n")[0]!;
    expect(readability(body, [DISCLOSURE, PRIVATE]).grade).toBeLessThanOrEqual(READING_GRADE_TARGET);
  });

  it("email versions carry the CAN-SPAM footer: paid-service notice, postal address and opt-out", () => {
    const r = render("email-first");
    expect(r.subject).toBe("Unclaimed property in the name of Margaret A. Delacroix");
    expect(r.text).toContain("This email is an offer of a paid service from Sample Recovery LLC, 100 W Liberty St, Suite 500, Reno, NV 89501.");
    expect(r.text).toContain("https://app.example.com/u/abcdefghjkmnpqrs");
    expect(r.html).toContain('href="https://app.example.com/u/abcdefghjkmnpqrs"');
    expect(r.text).toContain("reply with the word STOP");
  });

  it("first letters include the public-records FAQ insert on its own page; follow-ups do not", () => {
    expect(render("letter-first").html).toContain("page-break");
    expect(render("letter-first").text).toContain("How did you find me?");
    expect(render("letter-followup").text).not.toContain("How did you find me?");
  });

  it("letters leave the address zone blank for the mail vendor and use no images or seals", () => {
    const r = render("letter-first");
    expect(r.html).toContain('<div class="address-zone"></div>');
    expect(r.html).not.toMatch(/<img|<svg|seal/i);
  });
});

describe("renderer safety", () => {
  it("escapes HTML and Markdown in values (names, AI notes)", () => {
    const r = render("letter-first", vars({ heirName: '<script>alert("x")</script> **Bold** [link](http://evil.example)', personalNote: "# Heading\n- item" }));
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).not.toContain("<strong>Bold</strong>");
    expect(r.html).not.toContain('href="http://evil.example"');
    expect(r.html).not.toMatch(/<h1|<li/);
    expect(escapeMarkdownValue("a_b*c")).toBe("a\\_b\\*c");
  });

  it("refuses unsafe URLs and missing required values", () => {
    expect(() => render("letter-first", vars({ optOutUrl: "javascript:alert(1)" }))).toThrow(RenderError);
    expect(() => render("letter-first", vars({ disclosure: "" }))).toThrow(/disclosure/);
  });

  it("drops the personal-note paragraph when it is empty", () => {
    const r = render("letter-first", vars({ personalNote: "" }));
    expect(r.text).toMatch(/Dear Jordan Delacroix,\n\nMy name is Pat Rivera/);
  });

  it("hashes recipient + content: any change gives a different hash", () => {
    const r = render("letter-first");
    const base = contentHashOf({ channel: "MAIL", recipient: mail, ...r });
    expect(contentHashOf({ channel: "MAIL", recipient: mail, ...r })).toBe(base);
    expect(contentHashOf({ channel: "MAIL", recipient: { ...mail, address: { ...mail.address, zip: "89102" } } as Recipient, ...r })).not.toBe(base);
    expect(contentHashOf({ channel: "MAIL", recipient: mail, ...r, text: `${r.text} ` })).not.toBe(base);
  });
});

describe("banned-terms lint (rules 5, 6, 8)", () => {
  const opts = { requiredStatements: [DISCLOSURE, PRIVATE], allowedAmountsCents: [50000] };
  const blocked = (text: string) => lintOutreach(text, opts).filter((f) => f.severity === "block").map((f) => f.category);

  it.each([
    ["OFFICIAL NOTICE of unclaimed funds", "GOVERNMENT"],
    ["A final notice from the Treasury Department", "GOVERNMENT"],
    ["This is a state notice.", "GOVERNMENT"],
    ["Sent on behalf of the state", "GOVERNMENT"],
    ["Act now — this offer expires in 10 days.", "PRESSURE"],
    ["Respond within 14 days or the money will be lost.", "PRESSURE"],
    ["You could be worth thousands of dollars — a real windfall!", "EXAGGERATION"],
    ["Please send us your Social Security number.", "SENSITIVE_DATA"],
    ["Reply with your bank account details.", "SENSITIVE_DATA"],
    ["We will call you next week, or text us.", "CHANNEL"],
  ])("%s → %s", (text, category) => {
    expect(blocked(text)).toContain(category);
  });

  it("does not flag the required statements themselves", () => {
    expect(lintOutreach(`${DISCLOSURE} ${PRIVATE}`, opts)).toEqual([]);
  });

  it("flags a government word that is NOT inside the exact required statement", () => {
    const altered = PRIVATE.replace("any government agency", "a government agency");
    expect(blocked(altered)).toContain("GOVERNMENT");
  });

  it("flags any dollar amount other than the reported one (rule 8)", () => {
    expect(blocked("The State reports $500.00.")).toEqual([]);
    expect(blocked("The State reports $500.00, about $600.")).toContain("AMOUNT");
  });

  it("warns on exclamation marks", () => {
    expect(lintOutreach("Thank you!", opts)).toMatchObject([{ severity: "warn", category: "PRESSURE" }]);
  });
});

describe("amounts and fee wording (rules 2, 8)", () => {
  const p = (cents: number | null, min = false) => ({ category: "LIFE_INSURANCE" as const, holderName: null, reportedAmountCents: cents, amountIsMinimum: min });
  it("states exact cents, never rounding up", () => {
    expect(formatExactUsd(123456789)).toBe("$1,234,567.89");
    expect(amountStatement([p(99999)]).sentence).toBe("The amount reported to the State is $999.99.");
  });
  it("uses 'at least' for ranges and partially unknown totals", () => {
    expect(amountStatement([p(50000, true)]).sentence).toContain("at least $500.00");
    expect(amountStatement([p(50000), p(null)]).sentence).toContain("at least $500.00");
  });
  it("says so when the State does not show the amount", () => {
    expect(amountStatement([p(null)])).toEqual({ sentence: "The State's list does not show the amount.", allowedAmountsCents: [] });
  });
  it("describes several properties without inventing detail", () => {
    const s = propertySummary([
      { category: "LIFE_INSURANCE", holderName: "ACME LIFE INSURANCE CO", reportedAmountCents: 1, amountIsMinimum: false },
      { category: "ANNUITY", holderName: null, reportedAmountCents: 1, amountIsMinimum: false },
    ]);
    expect(s).toBe("2 items: a life insurance payment reported by Acme Life Insurance Co; and an annuity payment");
  });
  it("summarizes three or more properties by type so the sentence stays short", () => {
    const item = (category: "LIFE_INSURANCE" | "ANNUITY" | "OTHER" | "UNKNOWN") => ({ category, holderName: "SOME HOLDER", reportedAmountCents: 1, amountIsMinimum: false });
    expect(propertySummary([item("LIFE_INSURANCE"), item("LIFE_INSURANCE"), item("ANNUITY"), item("OTHER"), item("UNKNOWN")])).toBe(
      "5 items: 2 life insurance payments, an annuity payment and 2 other items",
    );
    expect(propertySummary([item("OTHER"), item("OTHER"), item("OTHER")])).toBe("3 items: 3 other items");
  });
  it("fee sentence names the percentage and that nothing is owed if nothing is recovered", () => {
    expect(feeSentence(1000)).toContain("our fee is 10% of the amount the State pays you");
    expect(feeSentence(1000)).toContain("you owe us nothing");
  });
});

describe("AI mocks", () => {
  it("personal note uses only the facts given and no money words", () => {
    const out = mockPersonalization({ ownerName: "Margaret Delacroix", deceasedWasRecipients: "parent", ownerDeathYear: 2020, step: 1, channel: "MAIL" });
    expect(out.personalNote).toBe("We were sorry to learn of the passing of your parent, Margaret Delacroix.");
    const unknown = mockPersonalization({ ownerName: "M D", deceasedWasRecipients: "UNKNOWN", ownerDeathYear: null, step: 1, channel: "MAIL" });
    expect(unknown.personalNote).not.toMatch(/your/);
  });
  it("mock tone check fails pressure wording", () => {
    const t = mockToneCheck({ channel: "MAIL", subject: null, text: "Act now, this is urgent.", requiredStatements: [] });
    expect(tonePassed(t)).toBe(false);
    expect(t.issues.length).toBeGreaterThan(0);
  });
});

describe("compliance checklist", () => {
  const base: ChecklistFacts = {
    channel: "MAIL",
    step: 1,
    mockMode: true,
    caseStage: "READY_FOR_OUTREACH",
    eligibility: { status: "ELIGIBLE", eligibleContractDate: new Date("2026-01-01T00:00:00Z") },
    unverifiedRules: [],
    disclosure: { text: DISCLOSURE, inHtml: true, inText: true },
    privateCompany: { inHtml: true, inText: true },
    fee: { quotedBps: 1000, capBps: 1000 },
    lint: [],
    readability: { grade: 6, words: 300, sentences: 30, longestSentenceWords: 20 },
    bodyWords: 300,
    tone: { output: { verdict: "PASS", respectful: 5, pressureFree: 5, plainLanguage: 5, issues: [] }, forCurrentContent: true },
    recipient: { problem: null, heirRejected: false, heirPredeceased: false },
    doNotContact: { blocked: false, reason: null },
    businessProfileComplete: true,
    emailFooter: null,
    counsel: { approved: false, detail: "" },
    providerConfigured: { ok: true, name: "mock" },
    sequence: { ok: true, detail: "" },
  };

  it("all green in demo mode (counsel sign-off is a warning there)", () => {
    const items = buildChecklist(base);
    expect(checklistPasses(items)).toBe(true);
    expect(items.find((i) => i.key === "counsel")?.status).toBe("warn");
  });

  it.each<[string, Partial<ChecklistFacts>]>([
    ["void_period", { eligibility: { status: "WAITING", eligibleContractDate: new Date("2027-01-01T00:00:00Z"), daysRemaining: 30 } }],
    ["void_period", { eligibility: { status: "UNKNOWN", reason: "No delivery date.", missingPropertyIds: ["p1"] } }],
    ["rules_verified", { unverifiedRules: ["FEE_CAP"] }],
    ["disclosure", { disclosure: { text: DISCLOSURE, inHtml: false, inText: true } }],
    ["private_company", { privateCompany: { inHtml: true, inText: false } }],
    ["fee", { fee: { quotedBps: 2000, capBps: 1000 } }],
    ["fee", { fee: { quotedBps: 1000, capBps: null } }],
    ["tone", { tone: { output: { verdict: "PASS", respectful: 5, pressureFree: 5, plainLanguage: 5, issues: [] }, forCurrentContent: false } }],
    ["do_not_contact", { doNotContact: { blocked: true, reason: "x" } }],
    ["banned_terms", { lint: [{ category: "PRESSURE", term: "act now", excerpt: "", severity: "block", message: "" }] }],
    ["amounts", { lint: [{ category: "AMOUNT", term: "$9", excerpt: "", severity: "block", message: "" }] }],
    ["counsel", { mockMode: false }],
    ["case_stage", { caseStage: "WAITING_PERIOD" }],
    ["contact_details", { businessProfileComplete: false }],
  ])("blocks approval when %s fails", (key, patch) => {
    const items = buildChecklist({ ...base, ...patch });
    expect(items.find((i) => i.key === key)?.status).toBe("fail");
    expect(checklistPasses(items)).toBe(false);
  });

  it("email needs the CAN-SPAM footer", () => {
    const items = buildChecklist({ ...base, channel: "EMAIL", emailFooter: { hasOptOutLink: false, hasPostalAddress: true } });
    expect(items.find((i) => i.key === "can_spam")?.status).toBe("fail");
  });
});

describe("opt-out tokens and Lob webhooks", () => {
  it("tokens are 16 readable, unguessable characters", () => {
    const t = newOptOutToken();
    expect(isOptOutToken(t)).toBe(true);
    expect(new Set(Array.from({ length: 50 }, newOptOutToken)).size).toBe(50);
    expect(isOptOutToken("../../etc/passwd")).toBe(false);
  });

  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", event_type: { id: "letter.returned_to_sender" }, body: { id: "ltr_1" }, date_created: "2026-11-26T00:00:00Z" });
  const now = Date.UTC(2026, 10, 26, 12, 0, 0);
  const ts = String(Math.floor(now / 1000));
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

  it("accepts a correctly signed, fresh event", () => {
    expect(verifyLobSignature({ rawBody: body, timestamp: ts, signature: sig, secret, now })).toBe(true);
  });
  it("rejects tampering, a wrong secret, missing headers and stale timestamps", () => {
    expect(verifyLobSignature({ rawBody: body.replace("ltr_1", "ltr_2"), timestamp: ts, signature: sig, secret, now })).toBe(false);
    expect(verifyLobSignature({ rawBody: body, timestamp: ts, signature: sig, secret: "other", now })).toBe(false);
    expect(verifyLobSignature({ rawBody: body, timestamp: null, signature: sig, secret, now })).toBe(false);
    expect(verifyLobSignature({ rawBody: body, timestamp: ts, signature: sig, secret, now: now + 3_600_000 })).toBe(false);
  });
  it("maps Lob events to our statuses", () => {
    expect(parseLobEvent(JSON.parse(body))).toMatchObject({ id: "evt_1", eventType: "letter.returned_to_sender", letterId: "ltr_1" });
    expect(interpretLobEvent("letter.returned_to_sender").status).toBe("RETURNED");
    expect(interpretLobEvent("letter.processed_for_delivery").status).toBe("DELIVERED");
    expect(interpretLobEvent("letter.in_transit").status).toBeUndefined();
  });
});

describe("template variable list", () => {
  it("every variable is used by at least one template", () => {
    const all = loadTemplates().map((t) => `${t.subject ?? ""}${t.body}`).join("\n");
    for (const v of TEMPLATE_VARIABLES) expect(all, v).toContain(`{{${v}}}`);
  });
});
