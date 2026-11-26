/**
 * AI personalization and tone check for outreach drafts (spec 5.6, rule 8).
 * Both go through runPrompt (redaction, structured output, AiRun cost log).
 * The personal note is a suggestion: it is shown, editable, on the approval
 * screen and only "accepted" when the OWNER approves the message. The tone
 * check is a classifier; it never changes the text.
 */
import { z } from "zod";
import type { Relationship } from "@/lib/generated/prisma/enums";
import { LINT_RULES, withoutRequiredStatements } from "./lint";

export const PersonalizationOutput = z.object({
  personalNote: z.string().max(400),
  usedFacts: z.array(z.string()).max(10),
});
export type PersonalizationOutput = z.infer<typeof PersonalizationOutput>;

export const ToneCheckOutput = z.object({
  verdict: z.enum(["PASS", "NEEDS_CHANGES"]),
  respectful: z.number().int().min(1).max(5),
  pressureFree: z.number().int().min(1).max(5),
  plainLanguage: z.number().int().min(1).max(5),
  issues: z.array(z.object({ quote: z.string(), problem: z.string(), suggestion: z.string() })).max(20),
});
export type ToneCheckOutput = z.infer<typeof ToneCheckOutput>;

/** A tone check passes only with a PASS verdict and every score ≥ 4. */
export function tonePassed(t: ToneCheckOutput): boolean {
  return t.verdict === "PASS" && t.respectful >= 4 && t.pressureFree >= 4 && t.plainLanguage >= 4;
}

/** Heir's relationship to the owner → who the owner was to the heir. */
export const RELATIONSHIP_PHRASE: Partial<Record<Relationship, string>> = {
  SPOUSE: "spouse",
  CHILD: "parent",
  GRANDCHILD: "grandparent",
  PARENT: "child",
  SIBLING: "brother or sister",
  NIECE_NEPHEW: "aunt or uncle",
  GRANDPARENT: "grandchild",
  AUNT_UNCLE: "niece or nephew",
  COUSIN: "cousin",
};

export type PersonalizationInput = {
  ownerName: string;
  /**
   * Who the deceased was TO THE RECIPIENT ("parent" when the heir is the
   * owner's child), or "UNKNOWN". Derived from Person.relationship, which is
   * the heir's relationship to the owner.
   */
  deceasedWasRecipients: string;
  ownerDeathYear: number | null;
  step: number;
  channel: "MAIL" | "EMAIL";
};

export function deceasedWasRecipients(heirRelationship: Relationship): string {
  return RELATIONSHIP_PHRASE[heirRelationship] ?? "UNKNOWN";
}

/** Deterministic stand-in used in MOCK_MODE and as the eval baseline. */
export function mockPersonalization(input: Record<string, unknown>): PersonalizationOutput {
  const i = input as PersonalizationInput;
  if (i.step > 1) {
    return { personalNote: "I hope you are well. I am writing again about the letter I sent earlier.", usedFacts: ["step"] };
  }
  const rel = i.deceasedWasRecipients && i.deceasedWasRecipients !== "UNKNOWN" ? i.deceasedWasRecipients : null;
  const note = rel
    ? `We were sorry to learn of the passing of your ${rel}, ${i.ownerName}.`
    : `We were sorry to learn of the passing of ${i.ownerName}.`;
  return { personalNote: note, usedFacts: rel ? ["ownerName", "deceasedWasRecipients"] : ["ownerName"] };
}

export type ToneCheckInput = { channel: "MAIL" | "EMAIL"; subject: string | null; text: string; requiredStatements: string[] };

/** Deterministic stand-in: the banned-phrase list plus simple readability heuristics. */
export function mockToneCheck(input: Record<string, unknown>): ToneCheckOutput {
  const i = input as ToneCheckInput;
  const text = withoutRequiredStatements(`${i.subject ?? ""}\n${i.text}`, i.requiredStatements);
  const issues: ToneCheckOutput["issues"] = [];
  for (const rule of LINT_RULES) {
    for (const m of text.matchAll(rule.pattern)) {
      issues.push({ quote: m[0], problem: rule.message, suggestion: "Remove or rephrase in calm, plain words." });
    }
  }
  const longSentences = text.split(/[.!?]+\s|\n\s*\n/).filter((s) => s.split(/\s+/).length > 35);
  for (const s of longSentences.slice(0, 3)) {
    issues.push({ quote: s.slice(0, 80), problem: "Very long sentence.", suggestion: "Split it into two short sentences." });
  }
  const pressure = issues.some((x) => /pressure|deadline|loss/i.test(x.problem));
  const disrespect = issues.some((x) => /exaggerat|pushy|official|government|sensitive|calls and texts/i.test(x.problem));
  const respectful = disrespect ? 3 : 5;
  const pressureFree = pressure ? 2 : 5;
  const plainLanguage = longSentences.length ? 3 : 5;
  return {
    verdict: issues.length === 0 ? "PASS" : "NEEDS_CHANGES",
    respectful,
    pressureFree,
    plainLanguage,
    issues: issues.slice(0, 20),
  };
}
