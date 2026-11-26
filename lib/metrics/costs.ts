/**
 * Unit costs the founder enters (spec 11): per letter, per data lookup, per
 * e-signature, monthly hosting. Defaults are 0 so the dashboard never shows
 * invented numbers — it says which costs are still missing.
 */
import "server-only";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { prisma, type DbClient } from "@/lib/db";

export const UnitCostsSchema = z.object({
  perLetterCents: z.number().int().min(0).max(100_000).default(0),
  perDataLookupCents: z.number().int().min(0).max(100_000).default(0),
  perEsignCents: z.number().int().min(0).max(100_000).default(0),
  monthlyHostingCents: z.number().int().min(0).max(10_000_000).default(0),
});
export type UnitCosts = z.infer<typeof UnitCostsSchema>;

const KEY = "unit_costs";

export async function getUnitCosts(db: DbClient = prisma): Promise<UnitCosts> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  const parsed = UnitCostsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : UnitCostsSchema.parse({});
}

export async function saveUnitCosts(actor: { id: string; role: string }, raw: unknown) {
  const next = UnitCostsSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const before = await getUnitCosts(tx);
    await tx.appSetting.upsert({ where: { key: KEY }, update: { value: next, updatedById: actor.id }, create: { key: KEY, value: next, updatedById: actor.id } });
    await writeAudit(tx, { actor: { type: "USER", id: actor.id, role: actor.role }, action: "settings.unit_costs_saved", entityType: "AppSetting", entityId: KEY, before, after: next });
  });
  return next;
}
