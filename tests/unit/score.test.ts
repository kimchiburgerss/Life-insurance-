import { describe, expect, it } from "vitest";
import { parseDateOnly } from "@/lib/dates";
import { NEVADA_RULES } from "@/lib/rules/jurisdictions";
import { FeeCapParams, WaitingPeriodParams } from "@/lib/rules/schemas";
import { scoreCase, type ScoringProperty } from "@/lib/screening/score";

const rules = {
  waiting: WaitingPeriodParams.parse(NEVADA_RULES.find((r) => r.ruleType === "WAITING_PERIOD")!.params),
  feeCap: FeeCapParams.parse(NEVADA_RULES.find((r) => r.ruleType === "FEE_CAP")!.params),
};
const today = parseDateOnly("2026-11-26");
const owner = { normalizedName: "JANE Q DOE", addressState: "NV", hasAddress: true };

function prop(over: Partial<ScoringProperty> = {}): ScoringProperty {
  return {
    id: "p",
    category: "LIFE_INSURANCE",
    reportedAmountCents: 1_000_000,
    amountIsMinimum: false,
    hasDeceasedMarker: false,
    holderIsLifeInsurer: false,
    dateDeliveredToState: parseDateOnly("2023-01-10"),
    flags: [],
    ...over,
  };
}

describe("priority scoring", () => {
  it("is explainable: score = sum of listed factors", () => {
    const r = scoreCase([prop()], owner, rules, today);
    expect(r.score).toBe(r.factors.reduce((s, f) => s + f.points, 0));
    expect(r.explanation).toMatch(/^Score \d+\/100\./);
  });

  it("ranks life insurance above other property", () => {
    const life = scoreCase([prop()], owner, rules, today).score;
    const other = scoreCase([prop({ category: "OTHER" })], owner, rules, today).score;
    expect(life - other).toBe(25);
  });

  it("amount points grow on a log scale and cap at 25", () => {
    const pts = (cents: number) =>
      scoreCase([prop({ reportedAmountCents: cents })], owner, rules, today).factors.find((f) => f.label.includes("reported"))!.points;
    expect(pts(10_000)).toBe(10); // $100
    expect(pts(100_000)).toBe(15); // $1,000
    expect(pts(10_000_000)).toBe(25); // $100,000
    expect(pts(100_000_000)).toBe(25);
  });

  it("unknown amounts get neutral points and no expected value", () => {
    const r = scoreCase([prop({ reportedAmountCents: null })], owner, rules, today);
    expect(r.factors).toContainEqual({ label: "amount not disclosed by the state", points: 8 });
    expect(r.expectedValueCents).toBeNull();
  });

  it("expected value = amount × fee rate × probability", () => {
    const r = scoreCase([prop({ hasDeceasedMarker: true })], owner, rules, today);
    expect(r.feeBps).toBe(1000);
    expect(r.successProbability).toBe(0.3);
    expect(r.expectedValueCents).toBe(30_000); // $10,000 × 10% × 30%
  });

  it("uses the 20% tier when the earliest signing date is 5+ years after delivery", () => {
    expect(scoreCase([prop({ dateDeliveredToState: parseDateOnly("2019-05-01") })], owner, rules, today).feeBps).toBe(2000);
  });

  it("waiting-period cases use the fee tier at their eligible date", () => {
    const r = scoreCase([prop({ dateDeliveredToState: parseDateOnly("2026-01-01") })], owner, rules, today);
    expect(r.eligibility.status).toBe("WAITING");
    expect(r.feeBps).toBe(1000);
    expect(r.factors.some((f) => f.label.includes("waiting period"))).toBe(true);
  });

  it("penalizes tracing difficulty", () => {
    const base = scoreCase([prop()], owner, rules, today).score;
    expect(scoreCase([prop()], { ...owner, hasAddress: false }, rules, today).score).toBe(base - 8);
    expect(scoreCase([prop()], { ...owner, addressState: "CA" }, rules, today).score).toBe(base - 3);
    expect(scoreCase([prop()], { ...owner, normalizedName: "JOHN SMITH" }, rules, today).score).toBe(base - 3);
    expect(scoreCase([prop({ flags: ["BUSINESS"] })], owner, rules, today).score).toBeLessThan(base - 30);
  });

  it("an unknown delivery date is called out and earns no age points", () => {
    const r = scoreCase([prop({ dateDeliveredToState: null })], owner, rules, today);
    expect(r.eligibility.status).toBe("UNKNOWN");
    expect(r.factors).toContainEqual({ label: "delivery date unknown — outreach blocked until confirmed", points: 0 });
  });

  it("clamps to 0–100", () => {
    const r = scoreCase([prop({ flags: ["BUSINESS", "UNKNOWN", "TRUST"], category: "UNKNOWN", reportedAmountCents: 0 })], { ...owner, hasAddress: false }, rules, today);
    expect(r.score).toBe(0);
  });
});
