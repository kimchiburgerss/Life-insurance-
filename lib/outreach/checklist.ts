/**
 * The compliance checklist shown beside every draft on the approval screen
 * (spec 5.6: "compliance checklist (all green required)"). Pure: the facts are
 * gathered by lib/outreach/service.ts and the same function runs again inside
 * the approval transaction and in the send gateway, so a stale screen can't
 * approve a message that has since become non-compliant.
 *
 * status: "pass" | "warn" (shown, does not block) | "fail" (blocks approval).
 */
import type { CaseEligibility } from "@/lib/rules/engine";
import { formatBps } from "@/lib/rules/engine";
import type { LintFinding, Readability } from "./lint";
import { MAX_BODY_WORDS, READING_GRADE_TARGET } from "./lint";
import type { ToneCheckOutput } from "./ai";
import { tonePassed } from "./ai";

export type ChecklistStatus = "pass" | "warn" | "fail";
export type ChecklistItem = { key: string; label: string; status: ChecklistStatus; detail: string };

export type ChecklistFacts = {
  channel: "MAIL" | "EMAIL";
  step: number;
  mockMode: boolean;
  caseStage: string;
  eligibility: CaseEligibility;
  unverifiedRules: string[];
  /** Exact required texts and whether the SENT content (HTML) and text version contain them. */
  disclosure: { text: string | null; inHtml: boolean; inText: boolean };
  privateCompany: { inHtml: boolean; inText: boolean };
  fee: { quotedBps: number | null; capBps: number | null };
  lint: LintFinding[];
  readability: Readability;
  bodyWords: number;
  tone: { output: ToneCheckOutput | null; forCurrentContent: boolean };
  recipient: { problem: string | null; heirRejected: boolean; heirPredeceased: boolean };
  doNotContact: { blocked: boolean; reason: string | null };
  businessProfileComplete: boolean;
  emailFooter: { hasOptOutLink: boolean; hasPostalAddress: boolean } | null;
  counsel: { approved: boolean; detail: string };
  providerConfigured: { ok: boolean; name: string };
  sequence: { ok: boolean; detail: string };
};

const OUTREACH_STAGES_FIRST = new Set(["READY_FOR_OUTREACH", "CONTACTED"]);
const OUTREACH_STAGES_FOLLOW_UP = new Set(["CONTACTED"]);

export function buildChecklist(f: ChecklistFacts): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (key: string, label: string, ok: boolean | "warn", detail: string) =>
    items.push({ key, label, status: ok === "warn" ? "warn" : ok ? "pass" : "fail", detail });

  // Rule 1 — 24-month void period (never overridable for outreach).
  const e = f.eligibility;
  add(
    "void_period",
    "24-month void period has ended (NRS 120A.740)",
    e.status === "ELIGIBLE",
    e.status === "ELIGIBLE"
      ? `Eligible since ${e.eligibleContractDate.toISOString().slice(0, 10)}.`
      : e.status === "WAITING"
        ? `Not until ${e.eligibleContractDate.toISOString().slice(0, 10)} (${e.daysRemaining} days).`
        : `${e.reason} Fix the delivery date before outreach.`,
  );
  add(
    "rules_verified",
    "Rules used by this message are verified",
    f.unverifiedRules.length === 0,
    f.unverifiedRules.length ? `Not yet verified: ${f.unverifiedRules.join(", ")} (Jurisdiction rules page).` : "Waiting period, fee cap and disclosure rules are verified.",
  );
  const stages = f.step === 1 ? OUTREACH_STAGES_FIRST : OUTREACH_STAGES_FOLLOW_UP;
  add("case_stage", "Case is at an outreach stage", stages.has(f.caseStage), `Case stage: ${f.caseStage}.`);
  add("sequence", f.step === 1 ? "No earlier first contact to this person on this channel" : "Follow-up is still appropriate", f.sequence.ok, f.sequence.detail);

  // Recipient and do-not-contact.
  const recipientOk = !f.recipient.problem && !f.recipient.heirRejected && !f.recipient.heirPredeceased;
  add(
    "recipient",
    f.channel === "MAIL" ? "Recipient and full mailing address" : "Recipient and email address",
    recipientOk,
    f.recipient.heirRejected
      ? "This person was rejected as an heir."
      : f.recipient.heirPredeceased
        ? "This person is recorded as deceased."
        : (f.recipient.problem ?? "Complete."),
  );
  add("do_not_contact", "Not on the do-not-contact list and has not opted out", !f.doNotContact.blocked, f.doNotContact.reason ?? "No do-not-contact match.");

  // Rule 4 — free-claim disclosure, verbatim, in what is actually sent.
  add(
    "disclosure",
    "Free-claim disclosure with the State's program name and website (verbatim)",
    Boolean(f.disclosure.text) && f.disclosure.inHtml && f.disclosure.inText,
    !f.disclosure.text ? "No active DISCLOSURE_TEXT rule." : f.disclosure.inHtml && f.disclosure.inText ? "Present, word for word." : "Missing or altered.",
  );
  // Rule 5 — private company statement.
  add(
    "private_company",
    "States we are a private company, not part of or endorsed by the government",
    f.privateCompany.inHtml && f.privateCompany.inText,
    f.privateCompany.inHtml && f.privateCompany.inText ? "Present." : "Missing.",
  );
  // Rule 2 — fee within the cap.
  add(
    "fee",
    "Fee stated and within the legal cap",
    f.fee.quotedBps !== null && f.fee.capBps !== null && f.fee.quotedBps <= f.fee.capBps,
    f.fee.capBps === null
      ? "Fee cap cannot be computed (a delivery date is unknown)."
      : f.fee.quotedBps === null
        ? "No fee stated."
        : `Quoted ${formatBps(f.fee.quotedBps)}; cap ${formatBps(f.fee.capBps)}.`,
  );

  // Rules 5, 6, 8 — banned terms, amounts.
  const blocks = f.lint.filter((x) => x.severity === "block");
  const warns = f.lint.filter((x) => x.severity === "warn");
  add(
    "banned_terms",
    "No government look-alike, pressure, exaggeration or sensitive-data wording",
    blocks.filter((x) => x.category !== "AMOUNT").length === 0 ? (warns.length ? "warn" : true) : false,
    blocks.length || warns.length
      ? [...blocks, ...warns].filter((x) => x.category !== "AMOUNT").map((x) => `"${x.term}" — ${x.message}`).join(" ") || "None."
      : "None found.",
  );
  const amountIssues = blocks.filter((x) => x.category === "AMOUNT");
  add("amounts", "Only the reported amount is stated (no rounding up)", amountIssues.length === 0, amountIssues.length ? amountIssues.map((x) => `${x.term} is not the reported amount.`).join(" ") : "OK.");

  // Rule 8 — tone check (AI classifier) for THIS content.
  const t = f.tone.output;
  add(
    "tone",
    "Tone check: respectful, plain, pressure-free",
    Boolean(t && f.tone.forCurrentContent && tonePassed(t)),
    !t || !f.tone.forCurrentContent
      ? "Tone check has not run on the current text."
      : `${t.verdict === "PASS" ? "Passed" : "Needs changes"} (respectful ${t.respectful}/5, pressure-free ${t.pressureFree}/5, plain ${t.plainLanguage}/5).` +
          (t.issues.length ? ` ${t.issues.map((i) => `"${i.quote}": ${i.problem}`).join(" ")}` : ""),
  );
  add(
    "reading_level",
    `Plain language (grade ${READING_GRADE_TARGET} or below, under ${MAX_BODY_WORDS} words)`,
    f.readability.grade <= READING_GRADE_TARGET && f.bodyWords <= MAX_BODY_WORDS ? true : "warn",
    `Reading grade ${f.readability.grade}; ${f.bodyWords} words; longest sentence ${f.readability.longestSentenceWords} words.`,
  );

  // Spec 5.6 — a real person to reach; CAN-SPAM for email.
  add("contact_details", "Business name, contact person, postal address and phone", f.businessProfileComplete, f.businessProfileComplete ? "Complete (Settings)." : "Fill in the business profile in Settings.");
  if (f.channel === "EMAIL") {
    const ft = f.emailFooter;
    add(
      "can_spam",
      "Email: paid-service notice, postal address and working opt-out link (CAN-SPAM)",
      Boolean(ft?.hasOptOutLink && ft?.hasPostalAddress),
      ft?.hasOptOutLink && ft?.hasPostalAddress ? "Footer present." : "Footer incomplete.",
    );
  }
  add("counsel", "Template wording approved by counsel", f.counsel.approved ? true : f.mockMode ? "warn" : false, f.counsel.detail);
  add("provider", "Sending service configured", f.providerConfigured.ok, f.providerConfigured.name);
  return items;
}

export function checklistPasses(items: ChecklistItem[]): boolean {
  return items.every((i) => i.status !== "fail");
}
