/**
 * Case pipeline finite-state machine (pure — no database access).
 *
 * Two layers of enforcement:
 *  1. ALLOWED_TRANSITIONS — the only edges that exist. Anything else is
 *     rejected outright (no override).
 *  2. Guards — business/compliance preconditions on an edge. A guard returns a
 *     Block. `overridable: false` blocks can never be bypassed;
 *     `overridable: true` blocks need an OWNER override with a logged reason.
 */
import type { CaseStage } from "@/lib/generated/prisma/enums";
import type { CaseEligibility } from "@/lib/rules/engine";

export const STAGES = [
  "IMPORTED",
  "SCREENED",
  "OWNER_VERIFIED_DECEASED",
  "HEIRS_RESEARCHING",
  "HEIRS_IDENTIFIED",
  "WAITING_PERIOD",
  "READY_FOR_OUTREACH",
  "CONTACTED",
  "RESPONDED",
  "AGREEMENT_SENT",
  "AGREEMENT_SIGNED",
  "CLAIM_PACKET_PREPARED",
  "CLAIM_FILED",
  "CLAIM_APPROVED",
  "CLAIM_DENIED",
  "MORE_INFO_REQUESTED",
  "PAID_TO_HEIR",
  "FEE_INVOICED",
  "FEE_COLLECTED",
  "CLOSED_WON",
  "CLOSED_NO_HEIR",
  "CLOSED_DECLINED",
  "CLOSED_SELF_CLAIMED",
  "CLOSED_INELIGIBLE",
] as const satisfies readonly CaseStage[];

export const TERMINAL_STAGES: ReadonlySet<CaseStage> = new Set([
  "CLOSED_WON",
  "CLOSED_NO_HEIR",
  "CLOSED_DECLINED",
  "CLOSED_SELF_CLAIMED",
  "CLOSED_INELIGIBLE",
]);

/** Stages at which the case is still pre-agreement (heir may self-claim). */
const PRE_AGREEMENT: CaseStage[] = [
  "IMPORTED",
  "SCREENED",
  "OWNER_VERIFIED_DECEASED",
  "HEIRS_RESEARCHING",
  "HEIRS_IDENTIFIED",
  "WAITING_PERIOD",
  "READY_FOR_OUTREACH",
  "CONTACTED",
  "RESPONDED",
  "AGREEMENT_SENT",
];

export const ALLOWED_TRANSITIONS: Readonly<Record<CaseStage, readonly CaseStage[]>> = {
  IMPORTED: ["SCREENED", "CLOSED_INELIGIBLE"],
  SCREENED: ["OWNER_VERIFIED_DECEASED", "CLOSED_INELIGIBLE"],
  OWNER_VERIFIED_DECEASED: ["HEIRS_RESEARCHING", "CLOSED_INELIGIBLE"],
  HEIRS_RESEARCHING: ["HEIRS_IDENTIFIED", "CLOSED_NO_HEIR", "CLOSED_INELIGIBLE"],
  HEIRS_IDENTIFIED: ["WAITING_PERIOD", "READY_FOR_OUTREACH", "HEIRS_RESEARCHING", "CLOSED_NO_HEIR"],
  WAITING_PERIOD: ["READY_FOR_OUTREACH", "HEIRS_RESEARCHING", "CLOSED_SELF_CLAIMED", "CLOSED_INELIGIBLE"],
  READY_FOR_OUTREACH: ["CONTACTED", "HEIRS_RESEARCHING", "CLOSED_SELF_CLAIMED", "CLOSED_INELIGIBLE"],
  CONTACTED: ["RESPONDED", "CLOSED_DECLINED", "CLOSED_SELF_CLAIMED", "CLOSED_NO_HEIR"],
  RESPONDED: ["AGREEMENT_SENT", "CLOSED_DECLINED", "CLOSED_SELF_CLAIMED", "CLOSED_NO_HEIR"],
  AGREEMENT_SENT: ["AGREEMENT_SIGNED", "RESPONDED", "CLOSED_DECLINED", "CLOSED_SELF_CLAIMED"],
  AGREEMENT_SIGNED: ["CLAIM_PACKET_PREPARED", "CLOSED_DECLINED"],
  CLAIM_PACKET_PREPARED: ["CLAIM_FILED", "CLOSED_DECLINED"],
  CLAIM_FILED: ["CLAIM_APPROVED", "CLAIM_DENIED", "MORE_INFO_REQUESTED"],
  MORE_INFO_REQUESTED: ["CLAIM_FILED", "CLAIM_DENIED"],
  CLAIM_DENIED: ["CLAIM_PACKET_PREPARED", "CLOSED_INELIGIBLE"],
  CLAIM_APPROVED: ["PAID_TO_HEIR"],
  PAID_TO_HEIR: ["FEE_INVOICED"],
  FEE_INVOICED: ["FEE_COLLECTED"],
  FEE_COLLECTED: ["CLOSED_WON"],
  CLOSED_WON: [],
  CLOSED_NO_HEIR: [],
  CLOSED_DECLINED: [],
  CLOSED_SELF_CLAIMED: [],
  CLOSED_INELIGIBLE: [],
};

export function isTerminal(stage: CaseStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

export function isPreAgreement(stage: CaseStage): boolean {
  return PRE_AGREEMENT.includes(stage);
}

export function isAllowedTransition(from: CaseStage, to: CaseStage): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// ─── Guards ─────────────────────────────────────────────────────────────────

/** Facts about the case that guards need. Built by lib/case/transitions.ts. */
export type GuardContext = {
  today: Date;
  /** From the active WAITING_PERIOD rule. */
  eligibility: CaseEligibility;
  waitingPeriodRuleVerified: boolean;
  deathEvidenceCount: number;
  /** Non-rejected heirs with confidence ≥ threshold and ≥ 1 cited source. */
  qualifiedHeirCount: number;
  approvedOutboundSentCount: number;
  inboundReplyCount: number;
  sentAgreementCount: number;
  signedAgreementCount: number;
  approvedClaimPacketCount: number;
  invoiceCount: number;
  paidInvoiceCount: number;
};

export type BlockCode =
  | "NO_DEATH_EVIDENCE"
  | "NO_QUALIFIED_HEIR"
  | "VOID_PERIOD_NOT_ELAPSED"
  | "VOID_PERIOD_ALREADY_ELAPSED"
  | "DELIVERY_DATE_UNKNOWN"
  | "RULE_UNVERIFIED"
  | "NO_APPROVED_OUTREACH_SENT"
  | "NO_INBOUND_REPLY"
  | "NO_SENT_AGREEMENT"
  | "NO_SIGNED_AGREEMENT"
  | "NO_APPROVED_CLAIM_PACKET"
  | "NO_INVOICE"
  | "INVOICE_NOT_PAID";

export type Block = { code: BlockCode; message: string; overridable: boolean };

/** Minimum confidence for a person to count as an identified heir. */
export const HEIR_CONFIDENCE_THRESHOLD = 0.6;

function eligibilityBlocks(ctx: GuardContext, action: string): Block[] {
  const blocks: Block[] = [];
  const e = ctx.eligibility;
  if (e.status === "WAITING") {
    blocks.push({
      code: "VOID_PERIOD_NOT_ELAPSED",
      message:
        `NRS 120A.740 void period: ${action} is not allowed until ` +
        `${e.eligibleContractDate.toISOString().slice(0, 10)} (${e.daysRemaining} days).`,
      overridable: false,
    });
  } else if (e.status === "UNKNOWN") {
    blocks.push({
      code: "DELIVERY_DATE_UNKNOWN",
      message: `${e.reason} ${action} cannot be checked against the 24-month rule automatically.`,
      overridable: true,
    });
  }
  if (!ctx.waitingPeriodRuleVerified) {
    blocks.push({
      code: "RULE_UNVERIFIED",
      message:
        "The waiting-period rule has not been verified against the official statute " +
        "(Settings → Jurisdiction rules).",
      overridable: true,
    });
  }
  return blocks;
}

type Guard = (ctx: GuardContext) => Block[];

const GUARDS: Partial<Record<CaseStage, Guard>> = {
  OWNER_VERIFIED_DECEASED: (ctx) =>
    ctx.deathEvidenceCount > 0
      ? []
      : [
          {
            code: "NO_DEATH_EVIDENCE",
            message: "At least one cited source confirming the owner's death is required.",
            overridable: false,
          },
        ],
  HEIRS_IDENTIFIED: (ctx) =>
    ctx.qualifiedHeirCount > 0
      ? []
      : [
          {
            code: "NO_QUALIFIED_HEIR",
            message: `At least one probable heir with confidence ≥ ${HEIR_CONFIDENCE_THRESHOLD} and a cited source is required.`,
            overridable: false,
          },
        ],
  WAITING_PERIOD: (ctx) =>
    ctx.eligibility.status === "ELIGIBLE"
      ? [
          {
            code: "VOID_PERIOD_ALREADY_ELAPSED",
            message: "The void period has already ended; move the case to READY_FOR_OUTREACH instead.",
            overridable: false,
          },
        ]
      : [],
  READY_FOR_OUTREACH: (ctx) => eligibilityBlocks(ctx, "Outreach that solicits an agreement"),
  CONTACTED: (ctx) => [
    ...eligibilityBlocks(ctx, "Outreach that solicits an agreement"),
    ...(ctx.approvedOutboundSentCount > 0
      ? []
      : [
          {
            code: "NO_APPROVED_OUTREACH_SENT" as const,
            message: "No approved outbound letter or email has been sent for this case.",
            overridable: false,
          },
        ]),
  ],
  RESPONDED: (ctx) =>
    ctx.inboundReplyCount > 0
      ? []
      : [
          {
            code: "NO_INBOUND_REPLY",
            message: "Log the heir's reply (letter, email or phone note) first.",
            overridable: true,
          },
        ],
  AGREEMENT_SENT: (ctx) => [
    ...eligibilityBlocks(ctx, "Sending an agreement"),
    ...(ctx.sentAgreementCount > 0
      ? []
      : [
          {
            code: "NO_SENT_AGREEMENT" as const,
            message: "No approved agreement has been sent for this case.",
            overridable: false,
          },
        ]),
  ],
  AGREEMENT_SIGNED: (ctx) =>
    ctx.signedAgreementCount > 0
      ? []
      : [
          {
            code: "NO_SIGNED_AGREEMENT",
            message: "No signed agreement is on file.",
            overridable: false,
          },
        ],
  CLAIM_FILED: (ctx) =>
    ctx.approvedClaimPacketCount > 0
      ? []
      : [
          {
            code: "NO_APPROVED_CLAIM_PACKET",
            message: "The claim packet must be approved before filing.",
            overridable: false,
          },
        ],
  FEE_INVOICED: (ctx) =>
    ctx.invoiceCount > 0
      ? []
      : [{ code: "NO_INVOICE", message: "Create the invoice first.", overridable: false }],
  FEE_COLLECTED: (ctx) =>
    ctx.paidInvoiceCount > 0
      ? []
      : [{ code: "INVOICE_NOT_PAID", message: "No paid invoice is recorded.", overridable: true }],
};

export type TransitionCheck =
  | { ok: true; blocks: []; overridden: Block[] }
  | { ok: false; reason: "NOT_ALLOWED"; message: string; blocks: [] }
  | { ok: false; reason: "BLOCKED"; blocks: Block[] };

/**
 * Decide whether `from → to` may happen. Pass `override: true` only for an
 * OWNER who supplied a reason; it bypasses overridable blocks only.
 */
export function checkTransition(
  from: CaseStage,
  to: CaseStage,
  ctx: GuardContext,
  override = false,
): TransitionCheck {
  if (!isAllowedTransition(from, to)) {
    return {
      ok: false,
      reason: "NOT_ALLOWED",
      message: `Transition ${from} → ${to} is not part of the case pipeline.`,
      blocks: [],
    };
  }
  const blocks = GUARDS[to]?.(ctx) ?? [];
  if (blocks.length === 0) return { ok: true, blocks: [], overridden: [] };
  const hard = blocks.filter((b) => !b.overridable);
  if (hard.length > 0 || !override) return { ok: false, reason: "BLOCKED", blocks };
  return { ok: true, blocks: [], overridden: blocks };
}

/** After research completes, which stage should the case move to? */
export function stageAfterResearch(eligibility: CaseEligibility): CaseStage {
  return eligibility.status === "ELIGIBLE" ? "READY_FOR_OUTREACH" : "WAITING_PERIOD";
}

/** Human-readable stage label. */
export function stageLabel(stage: CaseStage): string {
  return stage
    .toLowerCase()
    .split("_")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}
