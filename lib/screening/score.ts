/**
 * Screening & prioritization (build spec 5.2) — pure, explainable scoring.
 *
 * priority score (0–100) = sum of the factors below, clamped.
 * expected value = estimated amount × fee rate × probability of success.
 *
 * The weights and the success-probability model are STARTING ASSUMPTIONS.
 * Recalibrate them once real outcomes exist (Phase 7 metrics show conversion
 * by factor). An AI tracing-difficulty estimate is added in Phase 3.
 */
import type { PropertyCategory } from "@/lib/generated/prisma/enums";
import { addYears, compareDates, isOnOrAfter, maxDate } from "@/lib/dates";
import { computeCaseEligibility, feeCapBpsForCase, type CaseEligibility } from "@/lib/rules/engine";
import type { FeeCapParams, WaitingPeriodParams } from "@/lib/rules/schemas";

export type ScoringProperty = {
  id: string;
  category: PropertyCategory;
  reportedAmountCents: number | null;
  amountIsMinimum: boolean;
  hasDeceasedMarker: boolean;
  holderIsLifeInsurer: boolean;
  dateDeliveredToState: Date | null;
  flags: string[];
};

export type ScoringOwner = {
  /** Uppercase normalized name, FIRST … LAST. */
  normalizedName: string;
  /** Latest known address state (2-letter), if any. */
  addressState: string | null;
  hasAddress: boolean;
};

export type Factor = { label: string; points: number };

/** Accepted AI tracing estimate (Phase 3): 1 = easy … 5 = very hard. */
export type TracingAssessment = { difficulty: number; rationale: string };
export const TRACING_POINTS: Record<number, number> = { 1: 4, 2: 2, 3: 0, 4: -4, 5: -8 };

export type ScoreResult = {
  score: number;
  factors: Factor[];
  explanation: string;
  eligibility: CaseEligibility;
  feeBps: number;
  successProbability: number;
  knownAmountCents: number | null;
  expectedValueCents: number | null;
};

export const CATEGORY_POINTS: Record<PropertyCategory, number> = {
  LIFE_INSURANCE: 30,
  ANNUITY: 25,
  ESTATE: 15,
  OTHER: 5,
  UNKNOWN: 3,
};

const CATEGORY_LABEL: Record<PropertyCategory, string> = {
  LIFE_INSURANCE: "life insurance proceeds",
  ANNUITY: "annuity / matured policy",
  ESTATE: "estate property",
  OTHER: "other property type",
  UNKNOWN: "property type not given",
};

/** Most common US surnames: tracing is harder, so a small penalty. */
const COMMON_SURNAMES = new Set(
  ("SMITH JOHNSON WILLIAMS BROWN JONES GARCIA MILLER DAVIS RODRIGUEZ MARTINEZ HERNANDEZ LOPEZ GONZALEZ WILSON " +
    "ANDERSON THOMAS TAYLOR MOORE JACKSON MARTIN LEE PEREZ THOMPSON WHITE HARRIS SANCHEZ CLARK RAMIREZ LEWIS ROBINSON").split(" "),
);

function amountPoints(dollars: number): number {
  if (dollars < 1) return 0;
  // $10 → 5, $100 → 10, $1k → 15, $10k → 20, $100k+ → 25
  return Math.max(0, Math.min(25, Math.round(5 * Math.log10(dollars))));
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function scoreCase(
  properties: ScoringProperty[],
  owner: ScoringOwner,
  rules: { waiting: WaitingPeriodParams; feeCap: FeeCapParams },
  today: Date,
  tracing: TracingAssessment | null = null,
): ScoreResult {
  const factors: Factor[] = [];
  const add = (points: number, label: string) => {
    if (points !== 0) factors.push({ label, points });
  };
  const flags = new Set(properties.flatMap((p) => p.flags));

  // 1. Property type (best property drives it)
  const best = properties.reduce<PropertyCategory>(
    (acc, p) => (CATEGORY_POINTS[p.category] > CATEGORY_POINTS[acc] ? p.category : acc),
    "UNKNOWN",
  );
  add(CATEGORY_POINTS[best], CATEGORY_LABEL[best]);

  // 2. Amount
  const known = properties.filter((p) => p.reportedAmountCents !== null);
  const knownAmountCents = known.length ? known.reduce((s, p) => s + p.reportedAmountCents!, 0) : null;
  const anyMinimum = known.some((p) => p.amountIsMinimum);
  if (knownAmountCents === null) add(8, "amount not disclosed by the state");
  else add(amountPoints(knownAmountCents / 100), `${anyMinimum ? "at least " : ""}${formatUsd(knownAmountCents)} reported`);

  // 3. Death indicators in the record itself
  if (properties.some((p) => p.hasDeceasedMarker)) add(12, "owner name marked as estate / deceased");
  if (properties.some((p) => p.holderIsLifeInsurer)) add(5, "holder is a life insurer");

  // 4. Age of record (fee tier, competition, trail freshness)
  const eligibility = computeCaseEligibility(properties, rules.waiting, today);
  const latestDelivered = maxDate(properties.map((p) => p.dateDeliveredToState).filter((d): d is Date => d !== null));
  if (eligibility.status === "UNKNOWN") {
    // Shown as a 0-point factor so the explanation still mentions it.
    factors.push({ label: "delivery date unknown — outreach blocked until confirmed", points: 0 });
  } else if (latestDelivered && isOnOrAfter(today, addYears(latestDelivered, 5, "rollForward"))) {
    add(8, "held by the state 5+ years (higher fee tier, fewer competing finders)");
  } else if (eligibility.status === "ELIGIBLE") {
    add(6, "past the 24-month waiting period");
  } else {
    add(3, `in the 24-month waiting period (${eligibility.daysRemaining} days left)`);
  }
  if (latestDelivered && isOnOrAfter(today, addYears(latestDelivered, 15, "rollForward"))) {
    add(-4, "record is 15+ years old (older trail)");
  }

  // 5. Grouped properties
  if (properties.length > 1) add(Math.min(8, 2 * (properties.length - 1)), `${properties.length} properties for this owner`);

  // 6. Tracing difficulty (heuristic)
  if (flags.has("BUSINESS")) add(-40, "owner looks like a business, not a person");
  if (flags.has("UNKNOWN")) add(-30, "owner name missing");
  if (flags.has("TRUST")) add(-6, "trust / custodial account (trustee may be the claimant)");
  if (!owner.hasAddress) add(-8, "no last-known address");
  else if (owner.addressState && owner.addressState !== "NV") add(-3, `last address out of state (${owner.addressState})`);
  const surname = owner.normalizedName.split(" ").filter((t) => !/^(JR|SR|II|III|IV)$/.test(t)).pop() ?? "";
  if (COMMON_SURNAMES.has(surname)) add(-3, "very common surname (harder to trace)");
  if (tracing) {
    const pts = TRACING_POINTS[tracing.difficulty] ?? 0;
    factors.push({ label: `AI tracing estimate ${tracing.difficulty}/5 (accepted): ${tracing.rationale}`.slice(0, 200), points: pts });
  }

  const score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));

  // Probability of success — starting heuristic, see header comment.
  let p = 0.2;
  if (properties.some((x) => x.hasDeceasedMarker)) p += 0.1;
  if (properties.some((x) => x.holderIsLifeInsurer)) p += 0.05;
  if (!owner.hasAddress) p -= 0.1;
  if (COMMON_SURNAMES.has(surname)) p -= 0.03;
  if (flags.has("BUSINESS") || flags.has("UNKNOWN")) p -= 0.15;
  const successProbability = Math.round(Math.max(0.02, Math.min(0.5, p)) * 100) / 100;

  // Fee rate at the earliest date an agreement could legally be signed.
  const earliestSigning =
    eligibility.status === "WAITING" && compareDates(eligibility.eligibleContractDate, today) > 0
      ? eligibility.eligibleContractDate
      : today;
  const feeBps =
    feeCapBpsForCase(properties, earliestSigning, rules.feeCap) ??
    Math.min(...rules.feeCap.tiers.filter((t) => t.minYearsHeld === 0).map((t) => t.capBps));

  const expectedValueCents =
    knownAmountCents === null ? null : Math.round((knownAmountCents * feeBps * successProbability) / 10_000);

  const top = [...factors].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const explanation =
    `Score ${score}/100. ` +
    top.map((f) => `${f.points > 0 ? "+" : ""}${f.points} ${f.label}`).join("; ") +
    `. Estimated success ${Math.round(successProbability * 100)}%, fee rate ${(feeBps / 100).toFixed(0)}%` +
    (expectedValueCents === null ? ", expected value unknown (amount not disclosed)." : `, expected value ${formatUsd(expectedValueCents)}.`);

  return {
    score,
    factors,
    explanation,
    eligibility,
    feeBps,
    successProbability,
    knownAmountCents,
    expectedValueCents,
  };
}
