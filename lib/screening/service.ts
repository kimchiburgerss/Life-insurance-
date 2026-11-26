import "server-only";
import type { DbClient } from "@/lib/db";
import { todayIn } from "@/lib/dates";
import { getActiveRule } from "@/lib/rules/repository";
import { scoreCase, type ScoringProperty } from "./score";

type StoredAddress = { line1?: string | null; zip5?: string | null; state?: string | null; postalCode?: string | null };

function latestAddress(json: unknown): StoredAddress | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  return json[json.length - 1] as StoredAddress;
}

/**
 * Recompute priority score, expected value and eligible contract date for the
 * given cases. Safe to run any time (idempotent); runs after every import and
 * after owner merges.
 */
export async function rescoreCases(db: DbClient, caseIds: string[], today: Date = todayIn()): Promise<number> {
  if (caseIds.length === 0) return 0;
  const rulesByState = new Map<string, Awaited<ReturnType<typeof loadRules>>>();
  async function loadRules(stateCode: string) {
    const [waiting, feeCap] = await Promise.all([
      getActiveRule(db, stateCode, "WAITING_PERIOD", today),
      getActiveRule(db, stateCode, "FEE_CAP", today),
    ]);
    return { waiting: waiting.params, feeCap: feeCap.params };
  }

  let updated = 0;
  for (let i = 0; i < caseIds.length; i += 500) {
    const chunk = caseIds.slice(i, i + 500);
    const cases = await db.case.findMany({
      where: { id: { in: chunk } },
      select: {
        id: true,
        stateCode: true,
        owner: { select: { normalizedName: true, lastKnownAddresses: true } },
        properties: {
          select: {
            id: true,
            category: true,
            reportedAmountCents: true,
            amountIsMinimum: true,
            hasDeceasedMarker: true,
            holderIsLifeInsurer: true,
            dateDeliveredToState: true,
            flags: true,
          },
        },
      },
    });
    for (const c of cases) {
      if (!rulesByState.has(c.stateCode)) rulesByState.set(c.stateCode, await loadRules(c.stateCode));
      const addr = latestAddress(c.owner.lastKnownAddresses);
      const result = scoreCase(
        c.properties as ScoringProperty[],
        {
          normalizedName: c.owner.normalizedName,
          addressState: addr?.state ?? null,
          hasAddress: Boolean(addr && (addr.line1 || addr.zip5 || addr.postalCode)),
        },
        rulesByState.get(c.stateCode)!,
        today,
      );
      await db.case.update({
        where: { id: c.id },
        data: {
          priorityScore: result.score,
          priorityExplanation: result.explanation,
          priorityFactors: result.factors,
          successProbability: result.successProbability,
          expectedValueCents: result.expectedValueCents,
          estimatedValueCents: result.knownAmountCents,
          eligibleContractDate:
            result.eligibility.status === "UNKNOWN" ? null : result.eligibility.eligibleContractDate,
          scoredAt: new Date(),
        },
      });
      updated++;
    }
  }
  return updated;
}
