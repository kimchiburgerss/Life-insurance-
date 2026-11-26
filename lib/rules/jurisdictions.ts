/**
 * Seed values for JurisdictionRule rows. These are loaded into the database by
 * `prisma/seed.ts`; at runtime the app reads the DATABASE copy (which the
 * founder can update), never these constants.
 *
 * ⚠️  Every Nevada rule ships with `lastVerifiedAt: null`. The founder (ideally
 * with Nevada counsel) must confirm each one against the official current text
 * of NRS 120A.740 and the Treasurer's investigator policies, then mark it
 * verified in Settings → Jurisdiction rules. Outreach and agreements are
 * blocked (override-with-reason only) while a rule they depend on is unverified.
 */
import type { RuleType } from "@/lib/generated/prisma/enums";
import type { RuleParamsFor } from "./schemas";

type RuleSeed<T extends RuleType = RuleType> = {
  stateCode: string;
  ruleType: T;
  version: number;
  params: RuleParamsFor<T>;
  effectiveFrom: string; // YYYY-MM-DD
  enabled: boolean;
  sourceCitation: string;
  sourceUrl?: string;
  notes?: string;
};

const NRS_120A_740 =
  "NRS 120A.740 (Agreement to locate property), as amended by 2021 Nev. Stat. (SB 71)";
const NRS_URL = "https://www.leg.state.nv.us/NRS/NRS-120A.html#NRS120ASec740";
const NV_HEIR_FINDER_FAQ =
  "https://www.nevadatreasurer.gov/uploadedFiles/treasurernvgov/content/Unclaimed_Property/Heir%20Finder%20FAQ's%202.2022.pdf";

export const NEVADA_RULES: RuleSeed[] = [
  {
    stateCode: "NV",
    ruleType: "WAITING_PERIOD",
    version: 1,
    params: { months: 24, firstEligibleDayOffset: 1, monthOverflow: "rollForward" },
    effectiveFrom: "2021-10-01",
    enabled: true,
    sourceCitation: `${NRS_120A_740}, subsection 1`,
    sourceUrl: NRS_URL,
    notes:
      "Agreement is void if entered into between the date the property was presumed " +
      "abandoned and 24 months after it was paid or delivered to the Administrator. " +
      "Conservative interpretation: first eligible day = day after the 24-month " +
      "anniversary; Feb 29 anniversaries roll forward to Mar 1. Verify effective date.",
  } satisfies RuleSeed<"WAITING_PERIOD">,
  {
    stateCode: "NV",
    ruleType: "FEE_CAP",
    version: 1,
    params: {
      tiers: [
        { minYearsHeld: 0, capBps: 1000 },
        { minYearsHeld: 5, capBps: 2000 },
      ],
      monthOverflow: "rollForward",
    },
    effectiveFrom: "2021-10-01",
    enabled: true,
    sourceCitation: `${NRS_120A_740}, subsection 2`,
    sourceUrl: NRS_URL,
    notes:
      "10% of total value if delivered to the Administrator less than 5 years before " +
      "signing; 20% if 5 years or more (20% tier added by SB 71, 2021). Verify against " +
      "the current official text and the Treasurer's Unclaimed Property Investigator Policies.",
  } satisfies RuleSeed<"FEE_CAP">,
  {
    stateCode: "NV",
    ruleType: "DISCLOSURE_TEXT",
    version: 1,
    params: {
      programName: "Nevada State Treasurer's Office, Unclaimed Property Division",
      claimWebsite: "https://claims.nevadaunclaimedproperty.gov",
      administratorWebsite: "https://www.nevadatreasurer.gov",
      text:
        "You can claim this property yourself, for free, directly from the Nevada " +
        "State Treasurer's Office, Unclaimed Property Division at " +
        "https://claims.nevadaunclaimedproperty.gov. You do not need to use our " +
        "service or pay anyone to file a claim.",
    },
    effectiveFrom: "2021-10-01",
    enabled: true,
    sourceCitation:
      "Founder ethics baseline (build spec rule 4); Nevada Treasurer claim portal",
    sourceUrl: "https://claims.nevadaunclaimedproperty.gov",
    notes:
      "Confirm the Treasurer's preferred public claim URL before sending (press " +
      "releases have also used claimitnevada.org and nvup.gov).",
  } satisfies RuleSeed<"DISCLOSURE_TEXT">,
  {
    stateCode: "NV",
    ruleType: "AGREEMENT_REQUIREMENTS",
    version: 1,
    params: {
      requiredFields: [
        "propertyDescription",
        "servicesDescription",
        "ownerSignature",
        "valueBeforeFee",
        "valueAfterFee",
        "feePercent",
        "dateDeliveredToState",
        "freeClaimDisclosure",
      ],
      requiresWriting: true,
      requiresOwnerSignature: true,
      requiresValueBeforeAndAfterFee: true,
      requiresDateDeliveredToState: true,
    },
    effectiveFrom: "2021-10-01",
    enabled: true,
    sourceCitation: `${NRS_120A_740}, subsection 2`,
    sourceUrl: NRS_URL,
    notes:
      "Agreement must be in writing, clearly set forth the nature of the property and " +
      "the services, be signed by the apparent owner, and state the value of the " +
      "property before and after the fee. The Treasurer's guidance also asks for the " +
      "date the property was paid or delivered to the Administrator.",
  } satisfies RuleSeed<"AGREEMENT_REQUIREMENTS">,
  {
    stateCode: "NV",
    ruleType: "CLAIM_REQUIREMENTS",
    version: 1,
    params: {
      checklist: [
        { key: "claim_form", label: "Signed Nevada claim form (signed by the heir)", required: true },
        { key: "claimant_id", label: "Claimant government-issued photo ID", required: true },
        { key: "death_certificate", label: "Owner's death certificate", required: true },
        { key: "relationship_proof", label: "Proof of relationship (birth/marriage certificates)", required: true },
        {
          key: "estate_authority",
          label: "Small-estate affidavit or letters of administration",
          required: false,
          condition: "When required by the Division for the estate's size/type",
        },
        { key: "agreement_copy", label: "Copy of the signed recovery agreement", required: true },
        {
          key: "notarization",
          label: "Notarized claimant signature",
          required: false,
          condition: "Claims of $500 or more",
        },
      ],
      notarizationThresholdCents: 50_000,
      powerOfAttorneyAccepted: false,
    },
    effectiveFrom: "2021-10-01",
    enabled: true,
    sourceCitation: "Nevada Treasurer Heir Finder FAQ (Feb 2022) and claim instructions",
    sourceUrl: NV_HEIR_FINDER_FAQ,
    notes: "Phase 6 uses this list. Confirm the current claim form requirements with the Division.",
  } satisfies RuleSeed<"CLAIM_REQUIREMENTS">,
  {
    stateCode: "NV",
    ruleType: "CLAIM_REQUIREMENTS",
    version: 2,
    params: {
      checklist: [
        { key: "claim_form", label: "Nevada claim form signed by the owner's heir (the claimant) — not by us", required: true },
        { key: "claimant_id", label: "Claimant government-issued photo ID", required: true },
        { key: "death_certificate", label: "Owner's death certificate", required: true },
        { key: "relationship_proof", label: "Proof of relationship to the owner (birth/marriage certificates)", required: true },
        {
          key: "small_estate_affidavit",
          label: "Small-estate affidavit",
          required: false,
          condition: "Estate within the small-estate limit ($25,000; $100,000 for a surviving spouse)",
        },
        {
          key: "letters_of_administration",
          label: "Letters of administration / testamentary (probate)",
          required: false,
          condition: "Estate above the small-estate limit",
        },
        { key: "agreement_copy", label: "Copy of the signed recovery agreement (for the file; the State is not a party)", required: true },
        { key: "notarization", label: "Notarized claimant signature on the claim form", required: false, condition: "Claims of $500 or more" },
      ],
      notarizationThresholdCents: 50_000,
      powerOfAttorneyAccepted: false,
      statePaysClaimantOnly: true,
      smallEstateAffidavitMaxCents: 2_500_000,
      smallEstateAffidavitSpouseMaxCents: 10_000_000,
    },
    effectiveFrom: "2021-10-01",
    enabled: true,
    sourceCitation: "Nevada Treasurer Unclaimed Property FAQ and Heir Finder FAQ (Feb 2022); NRS 146.080 (small-estate affidavit)",
    sourceUrl: "http://www.nevadatreasurer.gov/Unclaimed_Property/FAQ/",
    notes:
      "Per the Treasurer: the Office deals directly with the owner/heir, checks are payable only to the claimant, the " +
      "State is not a party to finder agreements and will not deduct or pay finder fees; a power of attorney is not " +
      "accepted; notarization is required for claims of $500 and over. Small-estate limits are from NRS 146.080 as " +
      "understood — verify current amounts. The Treasurer's FAQ also cites NRS 648.012 (private-investigator " +
      "licensing) — confirm with the Nevada PILB whether your activity requires a license.",
  } satisfies RuleSeed<"CLAIM_REQUIREMENTS">,
  {
    stateCode: "NV",
    ruleType: "INTESTATE_SUCCESSION",
    version: 1,
    params: {
      representation: "PER_STIRPES",
      spouseWithIssue: { oneChildLine: [1, 2], multipleChildLines: [1, 3] },
      spouseNoIssue: [
        { withClass: "PARENTS", spouse: [1, 2] },
        { withClass: "SIBLINGS", spouse: [1, 2] },
      ],
      noSpouseOrder: ["ISSUE", "PARENTS", "SIBLINGS", "GRANDPARENTS", "OTHER_KIN"],
      communityPropertyToSpouse: true,
      namedBeneficiaryFirst: true,
    },
    effectiveFrom: "2021-10-01",
    enabled: true,
    sourceCitation: "NRS 134.040–134.120 (descent of separate property); NRS 123.250 (community property)",
    sourceUrl: "https://www.leg.state.nv.us/NRS/NRS-134.html",
    notes:
      "RESEARCH AID, NOT LEGAL ADVICE. Separate property: spouse 1/2 with one child line, 1/3 with " +
      "more; no issue: spouse 1/2 with parents, else 1/2 with siblings, else all. No spouse: issue, " +
      "then parents, then siblings, then grandparents/kin. Community property to the spouse. Verify " +
      "the current text, the meaning of 'right of representation', and whether a policy's proceeds " +
      "are separate or community property with Nevada counsel.",
  } satisfies RuleSeed<"INTESTATE_SUCCESSION">,
];

/**
 * Disabled placeholders showing how another state is added: copy the Nevada
 * rows, change stateCode/params/citations, verify, then enable.
 */
export const PLACEHOLDER_RULES: RuleSeed[] = [
  {
    stateCode: "GA",
    ruleType: "FEE_CAP",
    version: 1,
    params: { tiers: [{ minYearsHeld: 0, capBps: 0 }], monthOverflow: "rollForward" },
    effectiveFrom: "2099-01-01",
    enabled: false,
    sourceCitation: "PLACEHOLDER — Georgia (O.C.G.A. Title 44, Ch. 12, Art. 5) not yet researched",
    notes: "Disabled placeholder. Research Georgia finder rules before enabling.",
  } satisfies RuleSeed<"FEE_CAP">,
  {
    stateCode: "NY",
    ruleType: "FEE_CAP",
    version: 1,
    params: { tiers: [{ minYearsHeld: 0, capBps: 0 }], monthOverflow: "rollForward" },
    effectiveFrom: "2099-01-01",
    enabled: false,
    sourceCitation: "PLACEHOLDER — New York (Abandoned Property Law § 1416) not yet researched",
    notes: "Disabled placeholder. Research New York finder rules before enabling.",
  } satisfies RuleSeed<"FEE_CAP">,
];

export const SUPPORTED_STATES = ["NV"] as const;
