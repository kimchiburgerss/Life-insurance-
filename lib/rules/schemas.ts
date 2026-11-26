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
  /** The state pays the owner/heir only — never the finder (fees are invoiced to the heir afterwards). */
  statePaysClaimantOnly: z.boolean().optional(),
  /** Small-estate affidavit ceilings; above these, letters of administration (probate) are needed. */
  smallEstateAffidavitMaxCents: z.number().int().min(0).optional(),
  smallEstateAffidavitSpouseMaxCents: z.number().int().min(0).optional(),
});
export type ClaimRequirementsParams = z.infer<typeof ClaimRequirementsParams>;

/** [numerator, denominator] — exact shares, no floating point. */
export const Fraction = z.tuple([z.number().int().min(0), z.number().int().positive()]);

export const IntestateSuccessionParams = z.object({
  /** How a deceased child's/sibling's share passes to their descendants. */
  representation: z.enum(["PER_STIRPES"]).default("PER_STIRPES"),
  /** Spouse's share of SEPARATE property when the decedent left issue. */
  spouseWithIssue: z.object({ oneChildLine: Fraction, multipleChildLines: Fraction }),
  /** Spouse's share when there is no issue, by the first class that exists (the rest goes to that class). */
  spouseNoIssue: z.array(z.object({ withClass: z.enum(["PARENTS", "SIBLINGS"]), spouse: Fraction })),
  /** Who takes, in order, when there is no surviving spouse. */
  noSpouseOrder: z.array(z.enum(["ISSUE", "PARENTS", "SIBLINGS", "GRANDPARENTS", "OTHER_KIN"])).min(1),
  /** Community property passes entirely to the surviving spouse. */
  communityPropertyToSpouse: z.boolean(),
  /** A living named beneficiary takes before intestate heirs (contract, not estate). */
  namedBeneficiaryFirst: z.boolean(),
});
export type IntestateSuccessionParams = z.infer<typeof IntestateSuccessionParams>;

export const RuleParamsSchemas = {
  WAITING_PERIOD: WaitingPeriodParams,
  FEE_CAP: FeeCapParams,
  DISCLOSURE_TEXT: DisclosureTextParams,
  AGREEMENT_REQUIREMENTS: AgreementRequirementsParams,
  CLAIM_REQUIREMENTS: ClaimRequirementsParams,
  INTESTATE_SUCCESSION: IntestateSuccessionParams,
} as const satisfies Record<RuleType, z.ZodType>;

export type RuleParamsFor<T extends RuleType> = z.infer<(typeof RuleParamsSchemas)[T]>;
