/**
 * Business profile and outreach settings, stored in AppSetting rows so the
 * founder edits them in Settings rather than in code. Every letter and email
 * names the business, a real person, a postal address and a phone number
 * (spec 5.6: "how to reach a real person"; CAN-SPAM: physical postal address).
 */
import "server-only";
import { z } from "zod";
import { webUrl } from "@/lib/security/url";
import { writeAudit } from "@/lib/audit";
import { prisma, type DbClient } from "@/lib/db";

const trimmed = (max: number) => z.string().trim().max(max);

export const PostalAddressSchema = z.object({
  line1: trimmed(120).min(1, "Street address is required"),
  line2: trimmed(120).optional().default(""),
  city: trimmed(60).min(1, "City is required"),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use the two-letter state code"),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP (or ZIP+4)"),
});
export type PostalAddress = z.infer<typeof PostalAddressSchema>;

export const BusinessProfileSchema = z.object({
  /** Legal name of the business (e.g. "Smith Asset Recovery LLC"). */
  legalName: trimmed(120).min(2, "Business name is required"),
  /** The real person heirs will talk to. */
  contactName: trimmed(80).min(2, "Contact person is required"),
  contactTitle: trimmed(80).optional().default(""),
  mailingAddress: PostalAddressSchema,
  phone: z
    .string()
    .trim()
    .regex(/^[0-9 ()+.-]{10,20}$/, "Enter a phone number a real person answers"),
  /** Mailbox emails are sent from and replies go to. */
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  website: webUrl("Enter a full URL (https://…)").optional().or(z.literal("")).default(""),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const CounselApprovalSchema = z.object({
  approvedBy: trimmed(120).min(2),
  approvedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** templateId → version that counsel approved. A new version needs a new approval. */
  templateVersions: z.record(z.string(), z.string()),
  recordedById: z.string(),
  recordedAt: z.string(),
});
export type CounselApproval = z.infer<typeof CounselApprovalSchema>;

export const OutreachSettingsSchema = z.object({
  /** The fee quoted in letters (basis points). Always capped by the FEE_CAP rule for the case. */
  feeBps: z.number().int().min(0).max(10_000).default(1000),
  /** Days after the first letter for each follow-up (spec 5.6: day 21 and day 45). */
  followUpDays: z.array(z.number().int().min(7).max(365)).max(2).default([21, 45]),
  /** Follow-up drafts are prepared this many days early so they can be approved on time. */
  followUpLeadDays: z.number().int().min(0).max(14).default(3),
  /** Pause every send (approved items wait) — e.g. while a template is being revised. */
  sendingPaused: z.boolean().default(false),
  counselApproval: CounselApprovalSchema.nullable().default(null),
});
export type OutreachSettings = z.infer<typeof OutreachSettingsSchema>;

const KEYS = { business: "business_profile", outreach: "outreach_settings" } as const;

export async function getBusinessProfile(db: DbClient = prisma): Promise<BusinessProfile | null> {
  const row = await db.appSetting.findUnique({ where: { key: KEYS.business } });
  if (!row) return null;
  const parsed = BusinessProfileSchema.safeParse(row.value);
  return parsed.success ? parsed.data : null;
}

export async function getOutreachSettings(db: DbClient = prisma): Promise<OutreachSettings> {
  const row = await db.appSetting.findUnique({ where: { key: KEYS.outreach } });
  const parsed = OutreachSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : OutreachSettingsSchema.parse({});
}

type SettingsActor = { id: string; role: string };

export async function saveBusinessProfile(actor: SettingsActor, raw: unknown): Promise<BusinessProfile> {
  const profile = BusinessProfileSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const before = await tx.appSetting.findUnique({ where: { key: KEYS.business } });
    await tx.appSetting.upsert({
      where: { key: KEYS.business },
      update: { value: profile, updatedById: actor.id },
      create: { key: KEYS.business, value: profile, updatedById: actor.id },
    });
    await writeAudit(tx, {
      actor: { type: "USER", id: actor.id, role: actor.role },
      action: "settings.business_profile_saved",
      entityType: "AppSetting",
      entityId: KEYS.business,
      before: before?.value ?? null,
      after: profile,
    });
  });
  return profile;
}

export async function saveOutreachSettings(
  actor: SettingsActor,
  patch: Partial<Omit<OutreachSettings, "counselApproval">> & { counselApproval?: CounselApproval | null },
  reason?: string,
): Promise<OutreachSettings> {
  return prisma.$transaction(async (tx) => {
    const current = await getOutreachSettings(tx);
    const next = OutreachSettingsSchema.parse({ ...current, ...patch });
    await tx.appSetting.upsert({
      where: { key: KEYS.outreach },
      update: { value: next, updatedById: actor.id },
      create: { key: KEYS.outreach, value: next, updatedById: actor.id },
    });
    await writeAudit(tx, {
      actor: { type: "USER", id: actor.id, role: actor.role },
      action: "settings.outreach_saved",
      entityType: "AppSetting",
      entityId: KEYS.outreach,
      before: current,
      after: next,
      reason,
    });
    return next;
  });
}

export function formatPostalAddress(a: PostalAddress): string[] {
  return [a.line1, a.line2, `${a.city}, ${a.state} ${a.zip}`].filter((l): l is string => Boolean(l));
}

/** Base URL for links printed in letters/emails (unsubscribe). */
export function publicAppUrl(): string {
  return (process.env.PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}
