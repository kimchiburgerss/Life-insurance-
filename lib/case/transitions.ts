import "server-only";
import { writeAudit, type Actor } from "@/lib/audit";
import { canTransitionTo, can, ForbiddenError } from "@/lib/auth/permissions";
import { prisma, type DbClient } from "@/lib/db";
import { todayIn } from "@/lib/dates";
import type { CaseStage, Role } from "@/lib/generated/prisma/enums";
import { computeCaseEligibility, type CaseEligibility } from "@/lib/rules/engine";
import { getActiveRule } from "@/lib/rules/repository";
import {
  ALLOWED_TRANSITIONS,
  checkTransition,
  HEIR_CONFIDENCE_THRESHOLD,
  isTerminal,
  type Block,
  type GuardContext,
} from "./stateMachine";

export class TransitionError extends Error {
  constructor(
    message: string,
    readonly blocks: Block[] = [],
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

export type TransitionActor =
  | { type: "USER"; id: string; role: Role }
  | { type: "SYSTEM"; id: string };

export type TransitionInput = {
  caseId: string;
  to: CaseStage;
  actor: TransitionActor;
  reason?: string;
  /** OWNER only; bypasses overridable blocks and is logged with the reason. */
  override?: boolean;
  today?: Date;
  ipAddress?: string;
};

const MIN_OVERRIDE_REASON = 10;

/** Recompute a case's eligibility from its properties and the active rule. */
export async function evaluateEligibility(
  db: DbClient,
  caseId: string,
  today: Date = todayIn(),
): Promise<{ eligibility: CaseEligibility; ruleVerified: boolean; stateCode: string }> {
  const c = await db.case.findUniqueOrThrow({
    where: { id: caseId },
    select: { stateCode: true, properties: { select: { id: true, dateDeliveredToState: true } } },
  });
  const rule = await getActiveRule(db, c.stateCode, "WAITING_PERIOD", today);
  return {
    eligibility: computeCaseEligibility(c.properties, rule.params, today),
    ruleVerified: rule.verified,
    stateCode: c.stateCode,
  };
}

/** Store the computed eligible_contract_date on the case (null when unknown). */
export async function refreshEligibleContractDate(
  db: DbClient,
  caseId: string,
  today: Date = todayIn(),
): Promise<CaseEligibility> {
  const { eligibility } = await evaluateEligibility(db, caseId, today);
  await db.case.update({
    where: { id: caseId },
    data: {
      eligibleContractDate:
        eligibility.status === "UNKNOWN" ? null : eligibility.eligibleContractDate,
    },
  });
  return eligibility;
}

async function buildGuardContext(db: DbClient, caseId: string, today: Date): Promise<GuardContext> {
  const { eligibility, ruleVerified } = await evaluateEligibility(db, caseId, today);
  const [
    deathEvidenceCount,
    qualifiedHeirCount,
    approvedOutboundSentCount,
    inboundReplyCount,
    sentAgreementCount,
    signedAgreementCount,
    approvedClaimPacketCount,
    invoiceCount,
    paidInvoiceCount,
  ] = await Promise.all([
    db.evidence.count({ where: { caseId, supportsDeath: true } }),
    db.person.count({
      where: {
        caseId,
        status: { not: "REJECTED" },
        isPredeceased: false,
        relationshipConfidence: { gte: HEIR_CONFIDENCE_THRESHOLD },
        NOT: { sourceEvidenceIds: { isEmpty: true } },
      },
    }),
    db.communication.count({
      where: {
        caseId,
        direction: "OUTBOUND",
        status: { in: ["SENT", "DELIVERED"] },
        approvalId: { not: null },
      },
    }),
    db.communication.count({ where: { caseId, direction: "INBOUND" } }),
    db.agreement.count({
      where: { caseId, status: { in: ["SENT", "SIGNED"] }, approvalId: { not: null } },
    }),
    db.agreement.count({ where: { caseId, status: "SIGNED" } }),
    db.claimPacket.count({
      where: {
        caseId,
        approvalId: { not: null },
        status: { in: ["APPROVED", "FILED", "APPROVED_BY_STATE", "DENIED_BY_STATE", "MORE_INFO_REQUESTED"] },
      },
    }),
    db.invoice.count({ where: { caseId, status: { not: "VOID" } } }),
    db.invoice.count({ where: { caseId, status: "PAID" } }),
  ]);
  return {
    today,
    eligibility,
    waitingPeriodRuleVerified: ruleVerified,
    deathEvidenceCount,
    qualifiedHeirCount,
    approvedOutboundSentCount,
    inboundReplyCount,
    sentAgreementCount,
    signedAgreementCount,
    approvedClaimPacketCount,
    invoiceCount,
    paidInvoiceCount,
  };
}

export type TransitionPreview = {
  to: CaseStage;
  allowedForRole: boolean;
  blocks: Block[];
  /** True when every block is overridable (OWNER may proceed with a reason). */
  overridable: boolean;
};

/** For the case page: every edge out of the current stage and what would block it. */
export async function previewTransitions(
  caseId: string,
  role: Role,
  today: Date = todayIn(),
): Promise<{ from: CaseStage; options: TransitionPreview[]; eligibility: CaseEligibility; ruleVerified: boolean }> {
  const c = await prisma.case.findUniqueOrThrow({ where: { id: caseId }, select: { stage: true } });
  const ctx = await buildGuardContext(prisma, caseId, today);
  const options = (ALLOWED_TRANSITIONS[c.stage] ?? []).map((to) => {
    const check = checkTransition(c.stage, to, ctx, false);
    const blocks = check.ok ? [] : check.blocks;
    return {
      to,
      allowedForRole: canTransitionTo(role, to),
      blocks,
      overridable: blocks.length > 0 && blocks.every((b) => b.overridable),
    };
  });
  return { from: c.stage, options, eligibility: ctx.eligibility, ruleVerified: ctx.waitingPeriodRuleVerified };
}

/**
 * The ONLY way a case changes stage. Validates the edge, runs compliance
 * guards, applies the change with optimistic concurrency, and appends an audit
 * entry in the same transaction.
 */
export async function transitionCase(input: TransitionInput) {
  const { caseId, to, actor } = input;
  const today = input.today ?? todayIn();
  const reason = input.reason?.trim() || undefined;

  if (actor.type === "USER" && !canTransitionTo(actor.role, to)) {
    throw new ForbiddenError(`Your role (${actor.role}) cannot move a case to ${to}.`);
  }
  if (input.override) {
    if (actor.type !== "USER" || !can(actor.role, "compliance:override")) {
      throw new ForbiddenError("Only the OWNER can override a compliance block.");
    }
    if (!reason || reason.length < MIN_OVERRIDE_REASON) {
      throw new TransitionError(
        `An override needs a written reason (at least ${MIN_OVERRIDE_REASON} characters).`,
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.case.findUniqueOrThrow({
      where: { id: caseId },
      select: { id: true, stage: true },
    });
    const from = current.stage;
    const ctx = await buildGuardContext(tx, caseId, today);
    const check = checkTransition(from, to, ctx, input.override ?? false);
    if (!check.ok) {
      if (check.reason === "NOT_ALLOWED") throw new TransitionError(check.message);
      throw new TransitionError(
        `Cannot move case to ${to}: ${check.blocks.map((b) => b.message).join(" ")}`,
        check.blocks,
      );
    }

    const eligibleContractDate =
      ctx.eligibility.status === "UNKNOWN" ? null : ctx.eligibility.eligibleContractDate;
    const updated = await tx.case.updateMany({
      where: { id: caseId, stage: from }, // optimistic concurrency
      data: {
        stage: to,
        stageChangedAt: new Date(),
        eligibleContractDate,
        closedAt: isTerminal(to) ? new Date() : null,
      },
    });
    if (updated.count !== 1) {
      throw new TransitionError("The case was changed by someone else. Reload and try again.");
    }

    const auditActor: Actor =
      actor.type === "USER" ? { type: "USER", id: actor.id, role: actor.role } : actor;
    await writeAudit(tx, {
      actor: auditActor,
      action: check.overridden.length > 0 ? "case.stage_changed.override" : "case.stage_changed",
      entityType: "Case",
      entityId: caseId,
      before: { stage: from },
      after: {
        stage: to,
        eligibleContractDate,
        overriddenBlocks: check.overridden.map((b) => b.code),
      },
      reason,
      ipAddress: input.ipAddress,
    });

    return { from, to, overridden: check.overridden };
  });
}
