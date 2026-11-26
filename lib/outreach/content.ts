/**
 * The facts a letter states, built conservatively (pure functions):
 *  - the property, as specifically as the State's list allows (spec 5.6);
 *  - the amount exactly as reported — never rounded up, ranges use the lower
 *    bound, unknown amounts say so (rule 8: no exaggerated amounts);
 *  - the fee as a percentage capped by the FEE_CAP rule (rule 2);
 *  - the private-company statement (rule 5; 39 U.S.C. 3001(h)).
 */
import type { PropertyCategory } from "@/lib/generated/prisma/enums";
import { displayName } from "@/lib/normalize/name";
import { formatBps } from "@/lib/rules/engine";

const STATE_NAMES: Record<string, string> = { NV: "Nevada" };

export function stateName(stateCode: string): string {
  return STATE_NAMES[stateCode] ?? stateCode;
}

export function privateCompanyStatement(stateCode: string): string {
  return `We are a private company. We are not part of, or endorsed by, the State of ${stateName(stateCode)} or any government agency.`;
}

const CATEGORY_PHRASE: Record<PropertyCategory, string> = {
  LIFE_INSURANCE: "life insurance payment",
  ANNUITY: "annuity payment",
  ESTATE: "payment held for the estate",
  OTHER: "unclaimed property item",
  UNKNOWN: "unclaimed property item",
};

function withArticle(phrase: string): string {
  return `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;
}

export type PropertyFact = {
  category: PropertyCategory;
  holderName: string | null;
  reportedAmountCents: number | null;
  amountIsMinimum: boolean;
};

function describeOne(p: PropertyFact): string {
  const holder = p.holderName?.trim() ? displayName(p.holderName.trim().toUpperCase()) : null;
  const phrase = withArticle(CATEGORY_PHRASE[p.category]);
  return holder ? `${phrase} reported by ${holder}` : phrase;
}

const CATEGORY_PLURAL: Record<PropertyCategory, string> = {
  LIFE_INSURANCE: "life insurance payments",
  ANNUITY: "annuity payments",
  ESTATE: "payments held for the estate",
  OTHER: "other items",
  UNKNOWN: "other items",
};

/**
 * "a life insurance payment reported by Acme Life Insurance Co" for one item,
 * both items for two, and counts by type for three or more (one long list
 * would make an unreadable sentence).
 */
export function propertySummary(properties: PropertyFact[]): string {
  if (properties.length === 0) throw new Error("A case with no properties cannot be described.");
  if (properties.length === 1) return describeOne(properties[0]!);
  if (properties.length === 2) return `2 items: ${describeOne(properties[0]!)}; and ${describeOne(properties[1]!)}`;
  const counts = new Map<string, number>();
  for (const p of properties) {
    const key = p.category === "UNKNOWN" ? "OTHER" : p.category;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => (a[0] === "OTHER" ? 1 : b[0] === "OTHER" ? -1 : b[1] - a[1]))
    .map(([cat, n]) => (n === 1 ? withArticle(CATEGORY_PHRASE[cat as PropertyCategory]) : `${n} ${CATEGORY_PLURAL[cat as PropertyCategory]}`));
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${properties.length} items: ${list}`;
}

/** "$1,234.56" — exact cents, never rounded. */
export function formatExactUsd(cents: number): string {
  const dollars = Math.floor(cents / 100).toLocaleString("en-US");
  return `$${dollars}.${String(cents % 100).padStart(2, "0")}`;
}

export type AmountStatement = { sentence: string; allowedAmountsCents: number[] };

export function amountStatement(properties: PropertyFact[]): AmountStatement {
  const known = properties.filter((p) => p.reportedAmountCents != null);
  if (known.length === 0) return { sentence: "The State's list does not show the amount.", allowedAmountsCents: [] };
  const total = known.reduce((s, p) => s + p.reportedAmountCents!, 0);
  const partial = known.length < properties.length || known.some((p) => p.amountIsMinimum);
  if (partial) {
    return {
      sentence: `The State's list shows at least ${formatExactUsd(total)}. It does not show the full amount.`,
      allowedAmountsCents: [total],
    };
  }
  return {
    sentence: `The ${properties.length > 1 ? "total " : ""}amount reported to the State is ${formatExactUsd(total)}.`,
    allowedAmountsCents: [total],
  };
}

export function feeSentence(feeBps: number): string {
  return (
    `If you choose our help, our fee is ${formatBps(feeBps)} of the amount the State pays you. ` +
    "You pay it only after you receive the money. If nothing is paid to you, you owe us nothing."
  );
}

/** "November 26, 2026" for a calendar date stored at UTC midnight. */
export function formatLetterDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(date);
}
