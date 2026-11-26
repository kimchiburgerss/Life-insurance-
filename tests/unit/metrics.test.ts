import { describe, expect, it } from "vitest";
import { breakEvenCasesPerMonth, ratio } from "@/lib/metrics/math";

describe("unit economics", () => {
  it("break-even = fixed monthly cost ÷ margin per closed case", () => {
    expect(breakEvenCasesPerMonth(30_000, 100_000, 20_000)).toBeCloseTo(0.375);
    expect(breakEvenCasesPerMonth(30_000, null, 20_000)).toBeNull();
    expect(breakEvenCasesPerMonth(30_000, 10_000, 20_000)).toBeNull(); // no margin → never breaks even
  });
  it("ratios are null without a denominator", () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
  });
});
