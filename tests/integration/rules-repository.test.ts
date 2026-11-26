import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { parseDateOnly } from "@/lib/dates";
import { getActiveRule, RuleNotFoundError } from "@/lib/rules/repository";

afterAll(() => prisma.$disconnect());

describe("jurisdiction rule lookup", () => {
  it("returns the seeded Nevada rules with validated params, unverified", async () => {
    const rule = await getActiveRule(prisma, "NV", "FEE_CAP", parseDateOnly("2026-11-26"));
    expect(rule.params.tiers.map((t) => t.capBps)).toEqual([1000, 2000]);
    expect(rule.verified).toBe(false);
    const wait = await getActiveRule(prisma, "NV", "WAITING_PERIOD", parseDateOnly("2026-11-26"));
    expect(wait.params.months).toBe(24);
  });

  it("never returns disabled placeholder states", async () => {
    await expect(getActiveRule(prisma, "GA", "FEE_CAP", parseDateOnly("2100-01-01"))).rejects.toBeInstanceOf(
      RuleNotFoundError,
    );
  });

  it("blocks (throws) when no rule is configured", async () => {
    await expect(getActiveRule(prisma, "NV", "FEE_CAP", parseDateOnly("2000-01-01"))).rejects.toBeInstanceOf(
      RuleNotFoundError,
    );
  });

  it("picks the version in effect on the given date", async () => {
    await prisma.jurisdictionRule.create({
      data: {
        stateCode: "NV",
        ruleType: "FEE_CAP",
        version: 99,
        params: { tiers: [{ minYearsHeld: 0, capBps: 500 }], monthOverflow: "rollForward" },
        effectiveFrom: parseDateOnly("2040-01-01"),
        sourceCitation: "Hypothetical future amendment (test)",
      },
    });
    expect((await getActiveRule(prisma, "NV", "FEE_CAP", parseDateOnly("2039-12-31"))).version).toBe(1);
    expect((await getActiveRule(prisma, "NV", "FEE_CAP", parseDateOnly("2040-01-01"))).params.tiers[0]!.capBps).toBe(500);
    await prisma.jurisdictionRule.deleteMany({ where: { version: 99 } });
  });

  it("refuses malformed params instead of silently allowing", async () => {
    await prisma.jurisdictionRule.create({
      data: {
        stateCode: "ZZ",
        ruleType: "FEE_CAP",
        params: { tiers: [{ minYearsHeld: 5, capBps: 2000 }] }, // no base tier
        effectiveFrom: parseDateOnly("2020-01-01"),
        sourceCitation: "Malformed (test)",
      },
    });
    await expect(getActiveRule(prisma, "ZZ", "FEE_CAP", parseDateOnly("2026-01-01"))).rejects.toThrow();
  });
});
