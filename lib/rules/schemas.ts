import { z } from "zod";
import type { RuleType } from "@/lib/generated/prisma/enums";

/**
 * Parameter shapes for each JurisdictionRule.ruleType. Rule values live in the
 * database (never hard-coded in business logic) so the founder can correct
 * them when the statute or the Treasurer's policies change.
 */

export const WaitingPeriodParams = z.object({
  /** Months after delivery to the state during which agreements are void. */
  months: z.number().int().positive(),
  /**
   * Days added after the end of the void period to get the first day an
   * agreement may be signed. 1 = "the day after the 24-month anniversary",
   * which avoids signing ON the last day of the void period.
   */
  firstEligibleDayOffset: z.number().int().min(0).default(1),
  /** How to treat a start day that doesn't exist in the target month. */
  monthOverflow: z.enum(["clamp", "rollForward"]).default("rollForward"),
});
export type WaitingPeriodParams = z.infer<typeof WaitingPeriodParams>;

export const FeeCapTier = z.object({
  /** Tier applies when signing date ≥ delivered date + this many years. */
  minYearsHeld: z.number().int().min(0),
  /** Maximum fee in basis points (1000 = 10%). */
  capBps: z.number().int().min(0).max(10_000),
});

export const FeeCapParams = z.object({
  tiers: z
    .array(FeeCapTier)
    .min(1)
    .refine((t) => t.some((x) => x.minYearsHeld === 0), {
      message: "fee cap tiers must include a base tier with minYearsHeld = 0",
    }),
  monthOverflow: z.enum(["clamp", "rollForward"]).default("rollForward"),
});
export type FeeCapParams = z.infer<typeof FeeCapParams>;

export const DisclosureTextParams = z.object({
  programName: z.string().min(1),
  claimWebsite: z.string().url(),
  administratorWebsite: z.string().url(),
  /** Short paragraph inserted into every first-contact letter, email and agreement. */
  text: z.string().min(1),
});
export type DisclosureTextParams = z.infer<typeof DisclosureTextParams>;

export const AgreementRequirementsParams = z.object({
  requiredFields: z.array(z.string()).min(1),
  requiresWriting: z.boolean(),
  requiresOwnerSignature: z.boolean(),
  requiresValueBeforeAndAfterFee: z.boolean(),
  requiresDateDeliveredToState: z.boolean(),
});
export type AgreementRequirementsParams = z.infer<typeof AgreementRequirementsParams>;

export const ClaimRequirementsParams = z.object({
  checklist: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        required: z.boolean(),
        condition: z.string().optional(),
      }),
    )
    .min(1),
  notarizationThresholdCents: z.number().int().min(0).optional(),
  powerOfAttorneyAccepted: z.boolean().optional(),
});
export type ClaimRequirementsParams = z.infer<typeof ClaimRequirementsParams>;

export const RuleParamsSchemas = {
  WAITING_PERIOD: WaitingPeriodParams,
  FEE_CAP: FeeCapParams,
  DISCLOSURE_TEXT: DisclosureTextParams,
  AGREEMENT_REQUIREMENTS: AgreementRequirementsParams,
  CLAIM_REQUIREMENTS: ClaimRequirementsParams,
} as const satisfies Record<RuleType, z.ZodType>;

export type RuleParamsFor<T extends RuleType> = z.infer<(typeof RuleParamsSchemas)[T]>;
