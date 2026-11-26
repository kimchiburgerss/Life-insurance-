/**
 * Waiting-period manager (build spec 5.5).
 *  - When research is complete (HEIRS_IDENTIFIED) the case moves on by itself:
 *    to WAITING_PERIOD while the 24-month void period runs, or straight to
 *    READY_FOR_OUTREACH when it is already over.
 *  - A nightly job unlocks cases whose eligible date has arrived and notifies
 *    the operator. Unlocks go through the normal guarded transition — a
 *    blocked unlock (e.g. unverified rule) is reported, never forced.
 */
import "server-only";
import { prisma } from "@/lib/db";
import { formatDateOnly, todayIn } from "@/lib/dates";
import { caseRef } from "@/lib/format";
import { notifyCase } from "@/lib/notifications";
import { evaluateEligibility, TransitionError, transitionCase } from "./transitions";

const SYSTEM = { type: "SYSTEM" as const, id: "job:waiting-period" };

export type AdvanceOutcome =
  | { moved: "WAITING_PERIOD" | "READY_FOR_OUTREACH" }
  | { moved: null; blocked: string };

export async function advanceAfterResearch(caseId: string, today: Date = todayIn()): Promise<AdvanceOutcome | null> {
  const c = await prisma.case.findUniqueOrThrow({ where: { id: caseId }, select: { stage: true, caseNumber: true } });
  if (c.stage !== "HEIRS_IDENTIFIED") return null;
  const { eligibility } = await evaluateEligibility(prisma, caseId, today);
  if (eligibility.status !== "ELIGIBLE") {
    await transitionCase({
      caseId,
      to: "WAITING_PERIOD",
      actor: SYSTEM,
      today,
      reason:
        eligibility.status === "WAITING"
          ? `Research complete; void period runs until ${formatDateOnly(eligibility.eligibleContractDate)}.`
          : "Research complete; delivery date unknown, so the case waits until it is confirmed.",
    });
    return { moved: "WAITING_PERIOD" };
  }
  try {
    await transitionCase({ caseId, to: "READY_FOR_OUTREACH", actor: SYSTEM, today, reason: "Research complete and past the void period." });
    await notifyCase(prisma, {
      caseId,
      kind: "CASE_UNLOCKED",
      title: `${caseRef(c.caseNumber)} is ready for outreach`,
      body: "Research is complete and the 24-month void period has ended.",
    });
    return { moved: "READY_FOR_OUTREACH" };
  } catch (e) {
    if (!(e instanceof TransitionError)) throw e;
    await notifyCase(prisma, { caseId, kind: "UNLOCK_BLOCKED", title: `${caseRef(c.caseNumber)} can't move to outreach yet`, body: e.message });
    return { moved: null, blocked: e.message };
  }
}

/** Nightly: unlock every WAITING_PERIOD case whose eligible date has arrived. */
export async function unlockDueCases(today: Date = todayIn()): Promise<{ unlocked: number; blocked: number }> {
  const due = await prisma.case.findMany({
    where: { stage: "WAITING_PERIOD", eligibleContractDate: { lte: today } },
    select: { id: true, caseNumber: true },
    orderBy: { eligibleContractDate: "asc" },
  });
  let unlocked = 0;
  let blocked = 0;
  for (const c of due) {
    try {
      await transitionCase({ caseId: c.id, to: "READY_FOR_OUTREACH", actor: SYSTEM, today, reason: "24-month void period ended." });
      unlocked++;
      await notifyCase(prisma, {
        caseId: c.id,
        kind: "CASE_UNLOCKED",
        title: `${caseRef(c.caseNumber)} unlocked: ready for outreach`,
        body: `The 24-month void period ended; outreach drafting can begin.`,
      });
    } catch (e) {
      if (!(e instanceof TransitionError)) throw e;
      blocked++;
      await notifyCase(prisma, { caseId: c.id, kind: "UNLOCK_BLOCKED", title: `${caseRef(c.caseNumber)} reached its unlock date but is blocked`, body: e.message });
    }
  }
  return { unlocked, blocked };
}
