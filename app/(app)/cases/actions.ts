"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/auth/permissions";
import { requestIp, requireOperator } from "@/lib/auth/session";
import { TransitionError, transitionCase } from "@/lib/case/transitions";
import { advanceAfterResearch } from "@/lib/case/waiting";
import type { CaseStage } from "@/lib/generated/prisma/enums";
import { STAGES } from "@/lib/case/stateMachine";

export type TransitionState = { error?: string; ok?: string; to?: string };

function asStage(v: FormDataEntryValue | null): CaseStage {
  const s = String(v);
  if (!(STAGES as readonly string[]).includes(s)) throw new Error("Unknown stage");
  return s as CaseStage;
}

/** Move one case (from the case page). */
export async function moveCase(_: TransitionState, formData: FormData): Promise<TransitionState> {
  const operator = await requireOperator("case:read");
  const caseId = String(formData.get("caseId"));
  const to = asStage(formData.get("to"));
  try {
    await transitionCase({
      caseId,
      to,
      actor: { type: "USER", id: operator.id, role: operator.role },
      reason: String(formData.get("reason") ?? "") || undefined,
      override: formData.get("override") === "on",
      ipAddress: await requestIp(),
    });
  } catch (e) {
    if (e instanceof TransitionError || e instanceof ForbiddenError) return { error: e.message, to };
    throw e;
  }
  // Research complete → the case moves on by itself (waiting period or outreach).
  let next = "";
  if (to === "HEIRS_IDENTIFIED") {
    const outcome = await advanceAfterResearch(caseId);
    if (outcome?.moved) next = ` It then moved to ${outcome.moved.toLowerCase().replaceAll("_", " ")} automatically.`;
    else if (outcome && "blocked" in outcome) next = ` It is past the waiting period but can't go to outreach yet: ${outcome.blocked}`;
  }
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/pipeline");
  revalidatePath("/screening");
  return { ok: `Moved to ${to.toLowerCase().replaceAll("_", " ")}.${next}`, to };
}

export type BulkState = { error?: string; ok?: string; failures?: string[] };

/** Screening queue: move many IMPORTED cases at once. Each still goes through every guard. */
export async function bulkScreen(_: BulkState, formData: FormData): Promise<BulkState> {
  const operator = await requireOperator("case:transition:research");
  const ids = formData.getAll("caseId").map(String).slice(0, 100);
  const to = formData.get("decision") === "INELIGIBLE" ? "CLOSED_INELIGIBLE" : "SCREENED";
  const reason = String(formData.get("reason") ?? "").trim();
  if (ids.length === 0) return { error: "Select at least one case." };
  if (to === "CLOSED_INELIGIBLE" && reason.length < 5) return { error: "Give a short reason for closing these cases." };

  const ip = await requestIp();
  const failures: string[] = [];
  for (const caseId of ids) {
    try {
      await transitionCase({
        caseId,
        to,
        actor: { type: "USER", id: operator.id, role: operator.role },
        reason: reason || undefined,
        ipAddress: ip,
      });
    } catch (e) {
      if (e instanceof TransitionError || e instanceof ForbiddenError) failures.push(e.message);
      else throw e;
    }
  }
  revalidatePath("/screening");
  revalidatePath("/pipeline");
  const moved = ids.length - failures.length;
  return {
    ok: `${moved} case${moved === 1 ? "" : "s"} ${to === "SCREENED" ? "screened in" : "closed as ineligible"}.`,
    failures,
  };
}
