/**
 * Jurisdiction rules engine — pure functions (no database access here).
 *
 * Compliance rules 1 (24-month void period) and 2 (fee cap) are enforced by
 * these functions. Every caller gets parameters from a JurisdictionRule row,
 * so changing the law means changing data, not code.
 */
import { addDays, addMonths, addYears, compareDates, isOnOrAfter, maxDate } from "@/lib/dates";
import type { FeeCapParams, WaitingPeriodParams } from "./schemas";

// ─── Rule 1: waiting (void) period ──────────────────────────────────────────

/**
 * First calendar date on which a recovery agreement may be signed for a
 * property delivered to the state on `dateDeliveredToState`.
 *
 * NV default: delivered + 24 months (rolling forward when the day doesn't
 * exist, e.g. Feb 29) + 1 day.
 */
export function computeEligibleContractDate(
  dateDeliveredToState: Date,
  params: WaitingPeriodParams,
): Date {
  const endOfVoidPeriod = addMonths(
    dateDeliveredToState,
    params.months,
    params.monthOverflow,
  );
  return addDays(endOfVoidPeriod, params.firstEligibleDayOffset);
}

export type CaseEligibility =
  | { status: "ELIGIBLE"; eligibleContractDate: Date }
  | { status: "WAITING"; eligibleContractDate: Date; daysRemaining: number }
  | { status: "UNKNOWN"; reason: string; missingPropertyIds: string[] };

/**
 * A case can only solicit an agreement once EVERY property in it is past its
 * void period, so the case date is the latest of the property dates. A
 * property without a delivery date makes the case UNKNOWN, which blocks
 * outreach (it cannot be enforced automatically).
 */
export function computeCaseEligibility(
  properties: { id: string; dateDeliveredToState: Date | null }[],
  params: WaitingPeriodParams,
  today: Date,
): CaseEligibility {
  if (properties.length === 0) {
    return { status: "UNKNOWN", reason: "Case has no properties.", missingPropertyIds: [] };
  }
  const missing = properties.filter((p) => !p.dateDeliveredToState).map((p) => p.id);
  if (missing.length > 0) {
    return {
      status: "UNKNOWN",
      reason:
        "Date delivered to the state is unknown for one or more properties. " +
        "Confirm it with the Unclaimed Property Division and record it before outreach.",
      missingPropertyIds: missing,
    };
  }
  const eligible = maxDate(
    properties.map((p) => computeEligibleContractDate(p.dateDeliveredToState!, params)),
  )!;
  if (isOnOrAfter(today, eligible)) return { status: "ELIGIBLE", eligibleContractDate: eligible };
  const daysRemaining = Math.round(compareDates(eligible, today) / 86_400_000);
  return { status: "WAITING", eligibleContractDate: eligible, daysRemaining };
}

// ─── Rule 2: fee cap ────────────────────────────────────────────────────────

/** Maximum fee (basis points) for one property signed on `signingDate`. */
export function feeCapBpsForProperty(
  dateDeliveredToState: Date,
  signingDate: Date,
  params: FeeCapParams,
): number {
  const applicable = params.tiers.filter((tier) =>
    isOnOrAfter(signingDate, addYears(dateDeliveredToState, tier.minYearsHeld, params.monthOverflow)),
  );
  // The highest threshold that has been reached determines the cap.
  const tier = applicable.reduce((best, t) => (t.minYearsHeld > best.minYearsHeld ? t : best));
  return tier.capBps;
}

/**
 * One agreement covers every property in a case at a single fee rate, so the
 * case cap is the LOWEST property cap (never charge above any property's cap).
 */
export function feeCapBpsForCase(
  properties: { dateDeliveredToState: Date | null }[],
  signingDate: Date,
  params: FeeCapParams,
): number | null {
  if (properties.length === 0 || properties.some((p) => !p.dateDeliveredToState)) return null;
  return Math.min(
    ...properties.map((p) => feeCapBpsForProperty(p.dateDeliveredToState!, signingDate, params)),
  );
}

export class FeeCapExceededError extends Error {
  constructor(
    readonly requestedBps: number,
    readonly capBps: number,
  ) {
    super(
      `Requested fee ${formatBps(requestedBps)} exceeds the legal cap of ${formatBps(capBps)}.`,
    );
    this.name = "FeeCapExceededError";
  }
}

/** Throws FeeCapExceededError if the requested fee is above the cap. */
export function assertFeeWithinCap(requestedBps: number, capBps: number): void {
  if (!Number.isInteger(requestedBps) || requestedBps < 0) {
    throw new RangeError("Fee must be a non-negative whole number of basis points.");
  }
  if (requestedBps > capBps) throw new FeeCapExceededError(requestedBps, capBps);
}

/**
 * Value before/after fee, in cents (compliance rule 3). The fee is rounded
 * DOWN so rounding always favours the heir.
 */
export function feeBreakdown(totalValueCents: number, feeBps: number) {
  if (!Number.isInteger(totalValueCents) || totalValueCents < 0) {
    throw new RangeError("Property value must be a non-negative whole number of cents.");
  }
  const feeCents = Math.floor((totalValueCents * feeBps) / 10_000);
  return {
    valueBeforeFeeCents: totalValueCents,
    feeCents,
    valueAfterFeeCents: totalValueCents - feeCents,
  };
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, "")}%`;
}
