import "server-only";
import type { DbClient } from "@/lib/db";
import type { RuleType } from "@/lib/generated/prisma/enums";
import { RuleParamsSchemas, type RuleParamsFor } from "./schemas";

export type ActiveRule<T extends RuleType> = {
  id: string;
  stateCode: string;
  ruleType: T;
  version: number;
  params: RuleParamsFor<T>;
  sourceCitation: string;
  verified: boolean;
};

export class RuleNotFoundError extends Error {
  constructor(stateCode: string, ruleType: RuleType, onDate: Date) {
    super(
      `No enabled ${ruleType} rule for ${stateCode} effective on ${onDate
        .toISOString()
        .slice(0, 10)}. The action is blocked until the rule is configured.`,
    );
    this.name = "RuleNotFoundError";
  }
}

/**
 * The enabled rule in effect on `onDate` (effectiveFrom ≤ date < effectiveTo),
 * highest version first. Params are validated; a malformed rule throws rather
 * than silently allowing an action.
 */
export async function getActiveRule<T extends RuleType>(
  db: DbClient,
  stateCode: string,
  ruleType: T,
  onDate: Date,
): Promise<ActiveRule<T>> {
  const row = await db.jurisdictionRule.findFirst({
    where: {
      stateCode,
      ruleType,
      enabled: true,
      effectiveFrom: { lte: onDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: onDate } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
  });
  if (!row) throw new RuleNotFoundError(stateCode, ruleType, onDate);
  const params = RuleParamsSchemas[ruleType].parse(row.params) as RuleParamsFor<T>;
  return {
    id: row.id,
    stateCode: row.stateCode,
    ruleType,
    version: row.version,
    params,
    sourceCitation: row.sourceCitation,
    verified: row.lastVerifiedAt !== null,
  };
}
