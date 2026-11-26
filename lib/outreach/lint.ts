/**
 * Banned-terms lint and plain-language checks for outreach (pure).
 *
 * Rule 5 (no government impersonation), rule 6 (no outbound calls/texts),
 * rule 8 (plain, respectful, pressure-free, no exaggerated amounts) and spec
 * 5.8 (never ask for an SSN by email). The REQUIRED statements — the free-claim
 * disclosure and the private-company statement — necessarily name the State
 * and the government, so they are removed before scanning (exact text only:
 * anything else that mentions the government is flagged).
 */

export type LintCategory = "GOVERNMENT" | "PRESSURE" | "EXAGGERATION" | "SENSITIVE_DATA" | "CHANNEL" | "AMOUNT";
export type LintFinding = {
  category: LintCategory;
  term: string;
  excerpt: string;
  severity: "block" | "warn";
  message: string;
};

type Rule = { category: LintCategory; pattern: RegExp; severity: "block" | "warn"; message: string };

const b = (words: string) => new RegExp(`\\b(?:${words})\\b`, "gi");

export const LINT_RULES: Rule[] = [
  // Rule 5 — nothing that reads as a government notice or sender.
  { category: "GOVERNMENT", pattern: b("official(?:ly)?|officials"), severity: "block", message: "Implies an official/government source." },
  { category: "GOVERNMENT", pattern: b("state notice|government notice|legal notice|important notice|notice of (?:unclaimed|abandoned)|final notice|second notice|past due"), severity: "block", message: "Notice-style wording looks like a government or collection letter." },
  { category: "GOVERNMENT", pattern: b("government(?:al)?|governmental agency|agency|department|division|bureau|treasury|treasurer(?:'s)?(?: office)?|administrator|comptroller|controller's office"), severity: "block", message: "Names a government body outside the required disclosure." },
  { category: "GOVERNMENT", pattern: b("seal|crest|emblem|badge|certified by|authorized by|approved by the state|state[- ]approved|state[- ]licensed|on behalf of the state|endorsed by|in cooperation with"), severity: "block", message: "Suggests government approval or affiliation." },
  { category: "GOVERNMENT", pattern: b("case number|claim number|file number|docket"), severity: "warn", message: "Official-sounding reference wording; prefer \"reference\"." },
  // Rule 8 — no pressure.
  { category: "PRESSURE", pattern: b("act now|act fast|act quickly|urgent(?:ly)?|immediately|right away|as soon as possible|asap|hurry|don't wait|do not wait|time[- ]sensitive"), severity: "block", message: "Creates pressure to respond." },
  { category: "PRESSURE", pattern: b("deadline|expires?|expiring|expiration|last chance|final chance|limited time|time is running out|running out|before it'?s too late|respond (?:within|by)|reply (?:within|by)|within \\d+ days|only \\d+ days|countdown|today only|don't miss|do not miss"), severity: "block", message: "Countdown or deadline language." },
  { category: "PRESSURE", pattern: b("forfeit(?:ed)?|lose (?:your|this|the) (?:money|property|funds|claim)|will be lost|be lost forever|permanently lost|escheat(?:ed)? forever"), severity: "block", message: "Threatens a loss." },
  { category: "PRESSURE", pattern: /!/g, severity: "warn", message: "Exclamation marks read as pushy in a letter about a death." },
  // Rule 8 — no exaggerated amounts.
  { category: "EXAGGERATION", pattern: b("guarantee(?:d|s)?|windfall|jackpot|fortune|free money|you(?:'ve| have) won|winner|congratulations|prize|lottery|huge|massive|substantial (?:sum|amount)|large sum|significant (?:sum|amount)|thousands of dollars|millions?"), severity: "block", message: "Exaggerates or sensationalizes the money." },
  { category: "EXAGGERATION", pattern: /\b(?:up to|could be worth|may be worth|worth over|or more)\b/gi, severity: "block", message: "Suggests more money than reported." },
  // Spec 5.8 — never ask for sensitive identifiers in a letter or email.
  {
    category: "SENSITIVE_DATA",
    pattern: /\b(?:send|provide|give|email|include|confirm|enter|reply with|tell us)\s+(?:us\s+)?(?:your\s+|the\s+)?(?:full\s+)?(?:social security(?: number)?|ssn|bank account|routing number|account number|credit card|debit card|password|pin\b|date of birth)/gi,
    severity: "block",
    message: "Asks for sensitive personal or financial details.",
  },
  // Rule 6 — no outbound calls or texts.
  { category: "CHANNEL", pattern: /\b(?:text (?:us|me)|we(?:'ll| will) (?:call|text) you|i(?:'ll| will) (?:call|text) you|sms|whatsapp)\b/gi, severity: "block", message: "Outbound calls and texts are not allowed; heirs call us." },
];

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** Text with each required statement (exact match) blanked out. */
export function withoutRequiredStatements(text: string, required: string[]): string {
  let out = text.replace(/\s+/g, " ");
  for (const s of required) {
    const norm = s.replace(/\s+/g, " ").trim();
    if (norm) out = out.split(norm).join(" ");
  }
  return out;
}

const AMOUNT = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\$\s?\d+(?:\.\d{2})?/g;

function amountToCents(s: string): number {
  const n = s.replace(/[$,\s]/g, "");
  const [d, c = "00"] = n.split(".");
  return Number(d) * 100 + Number(c.padEnd(2, "0"));
}

export type LintOptions = {
  /** Required statements (disclosure, private-company line) — exempt from the term scan. */
  requiredStatements: string[];
  /** Dollar amounts the message may state (the reported amount). Anything else is flagged. */
  allowedAmountsCents?: number[];
};

export function lintOutreach(text: string, opts: LintOptions): LintFinding[] {
  const scanned = withoutRequiredStatements(text, opts.requiredStatements);
  const findings: LintFinding[] = [];
  for (const rule of LINT_RULES) {
    for (const m of scanned.matchAll(rule.pattern)) {
      findings.push({
        category: rule.category,
        term: m[0],
        excerpt: excerptAround(scanned, m.index ?? 0, m[0].length),
        severity: rule.severity,
        message: rule.message,
      });
    }
  }
  if (opts.allowedAmountsCents) {
    const allowed = new Set(opts.allowedAmountsCents);
    for (const m of scanned.matchAll(AMOUNT)) {
      if (!allowed.has(amountToCents(m[0]))) {
        findings.push({
          category: "AMOUNT",
          term: m[0],
          excerpt: excerptAround(scanned, m.index ?? 0, m[0].length),
          severity: "block",
          message: "States a dollar amount other than the amount reported to the State.",
        });
      }
    }
  }
  return dedupe(findings);
}

function dedupe(findings: LintFinding[]): LintFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const k = `${f.category}|${f.term.toLowerCase()}|${f.excerpt}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─── Plain language ─────────────────────────────────────────────────────────

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export type Readability = { grade: number; words: number; sentences: number; longestSentenceWords: number };

/**
 * Flesch–Kincaid grade level. URLs, email addresses and the required statements
 * (fixed legal wording) are excluded so the score reflects our own writing.
 */
export function readability(text: string, exclude: string[] = []): Readability {
  const cleaned = withoutRequiredStatements(text, exclude)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/\$[\d,.]+/g, "money");
  const sentences = cleaned.split(/[.!?]+(?:\s|$)/).map((s) => s.trim()).filter((s) => /[a-z]/i.test(s));
  const words = cleaned.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (words.length === 0 || sentences.length === 0) return { grade: 0, words: 0, sentences: 0, longestSentenceWords: 0 };
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
  const longest = Math.max(...sentences.map((s) => (s.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length));
  return { grade: Math.round(grade * 10) / 10, words: words.length, sentences: sentences.length, longestSentenceWords: longest };
}

/** Target: a general audience letter at or below US grade 8. */
export const READING_GRADE_TARGET = 8;
/** Letters should be short (rule 8). Body words, excluding the FAQ insert and footer. */
export const MAX_BODY_WORDS = 450;
