/**
 * Make sure every jurisdiction rule shipped with this version exists in the
 * database. Idempotent: a rule that already exists — including one the founder
 * edited or verified — is never touched; new rule versions are added.
 * Called by `npm run db:seed` and on every production start (instrumentation.ts).
 */
import { prisma, type DbClient } from "@/lib/db";
import { parseDateOnly } from "@/lib/dates";
import { NEVADA_RULES, PLACEHOLDER_RULES } from "./jurisdictions";

export async function ensureJurisdictionRules(db: DbClient = prisma): Promise<{ total: number; nevada: number; placeholders: number }> {
  for (const rule of [...NEVADA_RULES, ...PLACEHOLDER_RULES]) {
    await db.jurisdictionRule.upsert({
      where: { stateCode_ruleType_version: { stateCode: rule.stateCode, ruleType: rule.ruleType, version: rule.version } },
      update: {},
      create: {
        stateCode: rule.stateCode,
        ruleType: rule.ruleType,
        version: rule.version,
        params: rule.params,
        effectiveFrom: parseDateOnly(rule.effectiveFrom),
        enabled: rule.enabled,
        sourceCitation: rule.sourceCitation,
        sourceUrl: rule.sourceUrl,
        notes: rule.notes,
      },
    });
  }
  return { total: NEVADA_RULES.length + PLACEHOLDER_RULES.length, nevada: NEVADA_RULES.length, placeholders: PLACEHOLDER_RULES.length };
}
