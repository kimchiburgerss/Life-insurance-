import { describe, expect, it } from "vitest";
import { formatDateOnly, parseDateOnly } from "@/lib/dates";
import {
  assertFeeWithinCap,
  computeCaseEligibility,
  computeEligibleContractDate,
  FeeCapExceededError,
  feeBreakdown,
  feeCapBpsForCase,
  feeCapBpsForProperty,
  formatBps,
} from "@/lib/rules/engine";
import { NEVADA_RULES } from "@/lib/rules/jurisdictions";
import { FeeCapParams, RuleParamsSchemas, WaitingPeriodParams } from "@/lib/rules/schemas";

const d = parseDateOnly;
const f = formatDateOnly;

const waiting = WaitingPeriodParams.parse(
  NEVADA_RULES.find((r) => r.ruleType === "WAITING_PERIOD")!.params,
);
const feeCap = FeeCapParams.parse(NEVADA_RULES.find((r) => r.ruleType === "FEE_CAP")!.params);

describe("Nevada seed rules", () => {
  it("every Nevada rule's params pass its schema", () => {
    for (const rule of NEVADA_RULES) {
      expect(() => RuleParamsSchemas[rule.ruleType].parse(rule.params)).not.toThrow();
    }
  });

  it("encodes 24 months and 10% / 20% tiers", () => {
    expect(waiting.months).toBe(24);
    expect(feeCap.tiers).toEqual([
      { minYearsHeld: 0, capBps: 1000 },
      { minYearsHeld: 5, capBps: 2000 },
    ]);
  });
});

describe("Rule 1 — 24-month void period (NRS 120A.740)", () => {
  it("eligible the day after the 24-month anniversary", () => {
    expect(f(computeEligibleContractDate(d("2024-01-15"), waiting))).toBe("2026-01-16");
  });

  it("month-end delivery dates", () => {
    expect(f(computeEligibleContractDate(d("2024-01-31"), waiting))).toBe("2026-02-01");
    expect(f(computeEligibleContractDate(d("2024-12-31"), waiting))).toBe("2027-01-01");
    expect(f(computeEligibleContractDate(d("2024-04-30"), waiting))).toBe("2026-05-01");
  });

  it("leap day delivery rolls forward (conservative)", () => {
    // Feb 29 2024 + 24 months → Mar 1 2026 (no Feb 29) → +1 day.
    expect(f(computeEligibleContractDate(d("2024-02-29"), waiting))).toBe("2026-03-02");
  });

  it("leap day delivery with clamp convention, if the founder chooses it", () => {
    const clamp = { ...waiting, monthOverflow: "clamp" as const };
    expect(f(computeEligibleContractDate(d("2024-02-29"), clamp))).toBe("2026-03-01");
  });

  it("anniversary falling on a leap day", () => {
    expect(f(computeEligibleContractDate(d("2026-02-28"), waiting))).toBe("2028-02-29");
  });

  it("offset 0 gives the exact anniversary", () => {
    const exact = { ...waiting, firstEligibleDayOffset: 0 };
    expect(f(computeEligibleContractDate(d("2024-01-15"), exact))).toBe("2026-01-15");
  });

  describe("case eligibility", () => {
    const props = [
      { id: "a", dateDeliveredToState: d("2023-06-01") },
      { id: "b", dateDeliveredToState: d("2024-03-10") }, // later → controls
    ];

    it("uses the LATEST property date", () => {
      const r = computeCaseEligibility(props, waiting, d("2025-01-01"));
      expect(r.status).toBe("WAITING");
      if (r.status === "WAITING") {
        expect(f(r.eligibleContractDate)).toBe("2026-03-11");
        expect(r.daysRemaining).toBe(434);
      }
    });

    it("is WAITING on the anniversary itself and ELIGIBLE the next day", () => {
      expect(computeCaseEligibility(props, waiting, d("2026-03-10")).status).toBe("WAITING");
      expect(computeCaseEligibility(props, waiting, d("2026-03-11")).status).toBe("ELIGIBLE");
    });

    it("is UNKNOWN (blocking) when any delivery date is missing", () => {
      const r = computeCaseEligibility(
        [...props, { id: "c", dateDeliveredToState: null }],
        waiting,
        d("2030-01-01"),
      );
      expect(r.status).toBe("UNKNOWN");
      if (r.status === "UNKNOWN") expect(r.missingPropertyIds).toEqual(["c"]);
    });

    it("is UNKNOWN for a case with no properties", () => {
      expect(computeCaseEligibility([], waiting, d("2030-01-01")).status).toBe("UNKNOWN");
    });
  });
});

describe("Rule 2 — fee cap tiers", () => {
  const delivered = d("2020-06-15");

  it("10% when held less than 5 years at signing", () => {
    expect(feeCapBpsForProperty(delivered, d("2022-06-16"), feeCap)).toBe(1000);
    expect(feeCapBpsForProperty(delivered, d("2025-06-14"), feeCap)).toBe(1000);
  });

  it("20% from exactly 5 years", () => {
    expect(feeCapBpsForProperty(delivered, d("2025-06-15"), feeCap)).toBe(2000);
    expect(feeCapBpsForProperty(delivered, d("2031-01-01"), feeCap)).toBe(2000);
  });

  it("leap-day delivery reaches the 5-year tier on Mar 1 (conservative)", () => {
    const leap = d("2020-02-29");
    expect(feeCapBpsForProperty(leap, d("2025-02-28"), feeCap)).toBe(1000);
    expect(feeCapBpsForProperty(leap, d("2025-03-01"), feeCap)).toBe(2000);
  });

  it("case cap is the lowest property cap", () => {
    const props = [
      { dateDeliveredToState: d("2018-01-01") }, // 20%
      { dateDeliveredToState: d("2023-01-01") }, // 10%
    ];
    expect(feeCapBpsForCase(props, d("2026-01-02"), feeCap)).toBe(1000);
  });

  it("case cap is null (blocking) when a delivery date is unknown", () => {
    expect(feeCapBpsForCase([{ dateDeliveredToState: null }], d("2026-01-02"), feeCap)).toBeNull();
  });

  it("refuses fees above the cap", () => {
    expect(() => assertFeeWithinCap(1000, 1000)).not.toThrow();
    expect(() => assertFeeWithinCap(1001, 1000)).toThrow(FeeCapExceededError);
    expect(() => assertFeeWithinCap(2000, 1000)).toThrow(/exceeds the legal cap of 10%/);
    expect(() => assertFeeWithinCap(-1, 1000)).toThrow(RangeError);
    expect(() => assertFeeWithinCap(10.5, 1000)).toThrow(RangeError);
  });

  it("rejects tier lists without a base tier", () => {
    expect(() => FeeCapParams.parse({ tiers: [{ minYearsHeld: 5, capBps: 2000 }] })).toThrow();
  });
});

describe("Rule 3 — value before and after fee", () => {
  it("rounds the fee down in the heir's favour", () => {
    expect(feeBreakdown(12_345, 1000)).toEqual({
      valueBeforeFeeCents: 12_345,
      feeCents: 1_234,
      valueAfterFeeCents: 11_111,
    });
  });

  it("handles large values without float error", () => {
    expect(feeBreakdown(2_000_000_000, 2000).feeCents).toBe(400_000_000);
  });

  it("formats basis points", () => {
    expect(formatBps(1000)).toBe("10%");
    expect(formatBps(1250)).toBe("12.50%");
  });
});
