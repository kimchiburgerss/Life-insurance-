/**
 * Agreement and portal settings (AppSetting "agreement_settings"): the
 * attorney-approved template text and the switch that turns it on, the
 * cancellation window, the optional call-booking link, and how long portal
 * links in letters stay valid.
 */
import "server-only";
import { z } from "zod";
import { webUrl } from "@/lib/security/url";
import { writeAudit } from "@/lib/audit";
import { prisma, type DbClient } from "@/lib/db";
import { getActiveRule } from "@/lib/rules/repository";
import { todayIn } from "@/lib/dates";
import { loadDraftAgreementTemplate, parseAgreementTemplate, validateAgreementTemplate, type AgreementTemplate } from "./template";

export const AttorneyTemplateSchema = z.object({
  body: z.string().min(200).max(60_000),
  version: z.string(),
  approvedBy: z.string().min(2).max(120),
  approvedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  uploadedById: z.string(),
  uploadedAt: z.string(),
});
export type AttorneyTemplate = z.infer<typeof AttorneyTemplateSchema>;

export const AgreementSettingsSchema = z.object({
  cancellationDays: z.number().int().min(3).max(60).default(10),
  bookingUrl: webUrl().or(z.literal("")).default(""),
  portalLinkDays: z.number().int().min(30).max(730).default(365),
  attorneyTemplate: AttorneyTemplateSchema.nullable().default(null),
  useAttorneyTemplate: z.boolean().default(false),
});
export type AgreementSettings = z.infer<typeof AgreementSettingsSchema>;

const KEY = "agreement_settings";

export async function getAgreementSettings(db: DbClient = prisma): Promise<AgreementSettings> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  const parsed = AgreementSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : AgreementSettingsSchema.parse({});
}

export async function saveAgreementSettings(actor: { id: string; role: string }, patch: Partial<AgreementSettings>, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const current = await getAgreementSettings(tx);
    const next = AgreementSettingsSchema.parse({ ...current, ...patch });
    if (next.useAttorneyTemplate && !next.attorneyTemplate) throw new Error("Upload the attorney-approved agreement first.");
    await tx.appSetting.upsert({ where: { key: KEY }, update: { value: next, updatedById: actor.id }, create: { key: KEY, value: next, updatedById: actor.id } });
    await writeAudit(tx, {
      actor: { type: "USER", id: actor.id, role: actor.role },
      action: "settings.agreement_saved",
      entityType: "AppSetting",
      entityId: KEY,
      before: { ...current, attorneyTemplate: current.attorneyTemplate ? { version: current.attorneyTemplate.version, approvedBy: current.attorneyTemplate.approvedBy } : null },
      after: { ...next, attorneyTemplate: next.attorneyTemplate ? { version: next.attorneyTemplate.version, approvedBy: next.attorneyTemplate.approvedBy, approvedOn: next.attorneyTemplate.approvedOn } : null },
      reason,
    });
    return next;
  });
}

/** Store the attorney-approved text (validated); it is NOT used until switched on. */
export async function uploadAttorneyTemplate(actor: { id: string; role: string }, input: { source: string; approvedBy: string; approvedOn: string }) {
  const source = input.source.replace(/\r\n/g, "\n").trim();
  const body = source.startsWith("---") ? parseAgreementTemplate(source).body : source;
  const rule = await getActiveRule(prisma, "NV", "AGREEMENT_REQUIREMENTS", todayIn());
  const problems = validateAgreementTemplate(body, rule.params.requiredFields);
  if (problems.length) throw new Error(`The uploaded agreement cannot be used: ${problems.join("; ")}.`);
  const current = await getAgreementSettings();
  const n = current.attorneyTemplate ? Number(current.attorneyTemplate.version.replace(/\D/g, "")) + 1 : 1;
  return saveAgreementSettings(
    actor,
    {
      attorneyTemplate: { body, version: `attorney-${n}`, approvedBy: input.approvedBy.trim(), approvedOn: input.approvedOn, uploadedById: actor.id, uploadedAt: new Date().toISOString() },
      useAttorneyTemplate: false,
    },
    `Attorney-approved agreement uploaded (approved by ${input.approvedBy.trim()} on ${input.approvedOn}); not yet switched on.`,
  );
}

/** The template in use: the attorney version when switched on, else the shipped DRAFT. */
export async function currentAgreementTemplate(db: DbClient = prisma): Promise<AgreementTemplate> {
  const s = await getAgreementSettings(db);
  if (s.useAttorneyTemplate && s.attorneyTemplate) {
    return { id: "recovery-agreement", version: s.attorneyTemplate.version, title: "Recovery Services Agreement", body: s.attorneyTemplate.body, attorneyApproved: true };
  }
  return loadDraftAgreementTemplate();
}
