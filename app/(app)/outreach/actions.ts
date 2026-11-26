"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AiOutputError } from "@/lib/ai/run";
import { AiRefusedError } from "@/lib/ai/provider";
import { AiDecisionError } from "@/lib/ai/acceptance";
import { ForbiddenError } from "@/lib/auth/permissions";
import { requestIp, requireOperator } from "@/lib/auth/session";
import { TransitionError } from "@/lib/case/transitions";
import { prisma } from "@/lib/db";
import { enqueueDispatch } from "@/lib/jobs/queue";
import { dispatchCommunication, SendRefusedError } from "@/lib/outreach/gateway";
import { RenderError } from "@/lib/outreach/render";
import * as outreach from "@/lib/outreach/service";

export type ActionState = { ok?: string; error?: string };

function expected(e: unknown): string | null {
  if (
    e instanceof outreach.OutreachError ||
    e instanceof ForbiddenError ||
    e instanceof SendRefusedError ||
    e instanceof RenderError ||
    e instanceof TransitionError ||
    e instanceof AiOutputError ||
    e instanceof AiRefusedError ||
    e instanceof AiDecisionError
  ) {
    return e.message;
  }
  if (e instanceof Error && e.name === "RuleNotFoundError") return e.message;
  return null;
}

async function actor() {
  const op = await requireOperator("case:read");
  return { id: op.id, role: op.role };
}

function revalidateMessage(commId: string, caseId?: string) {
  revalidatePath(`/outreach/${commId}`);
  revalidatePath("/approvals");
  if (caseId) revalidatePath(`/cases/${caseId}`);
}

export async function createDraftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  const channel = fd.get("channel") === "EMAIL" ? "EMAIL" : "MAIL";
  let id: string;
  try {
    const comm = await outreach.createDraft(a, { caseId, personId: String(fd.get("personId")), channel });
    id = comm.id;
  } catch (e) {
    const msg = expected(e);
    if (msg) return { error: msg };
    throw e;
  }
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/approvals");
  redirect(`/outreach/${id}`);
}

export async function updateNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const commId = String(fd.get("commId"));
  try {
    await outreach.updateDraftNote(a, commId, String(fd.get("personalNote") ?? ""));
  } catch (e) {
    const msg = expected(e);
    if (msg) return { error: msg };
    throw e;
  }
  revalidateMessage(commId);
  return { ok: "Saved. The tone check and checklist were run again on the new text." };
}

export async function approveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("approval:decide");
  const commId = String(fd.get("commId"));
  let caseId: string | undefined;
  try {
    await outreach.approveCommunication({ id: op.id, role: op.role }, commId, {
      contentHash: String(fd.get("contentHash") ?? ""),
      confirmed: fd.get("confirm") === "on",
      ipAddress: await requestIp(),
    });
    const comm = await prisma.communication.findUniqueOrThrow({ where: { id: commId }, select: { caseId: true, scheduledFor: true } });
    caseId = comm.caseId;
    if (comm.scheduledFor && comm.scheduledFor > new Date()) {
      await enqueueDispatch().catch(() => undefined);
      revalidateMessage(commId, caseId);
      return { ok: `Approved. It will be sent on ${comm.scheduledFor.toISOString().slice(0, 10)}.` };
    }
    const result = await dispatchCommunication(commId);
    revalidateMessage(commId, caseId);
    switch (result.status) {
      case "SENT":
        return { ok: "Approved and sent." };
      case "PAUSED":
        return { ok: "Approved. Sending is paused in Settings, so it will go out when sending resumes." };
      case "FAILED":
      case "CANCELLED":
        return { error: `Approved, but not sent: ${result.reason}` };
      default:
        return { ok: "Approved." };
    }
  } catch (e) {
    const msg = expected(e);
    if (msg) {
      revalidateMessage(commId, caseId);
      return { error: msg };
    }
    throw e;
  }
}

export async function rejectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("approval:decide");
  const commId = String(fd.get("commId"));
  try {
    await outreach.rejectCommunication({ id: op.id, role: op.role }, commId, String(fd.get("reason") ?? ""), await requestIp());
  } catch (e) {
    const msg = expected(e);
    if (msg) return { error: msg };
    throw e;
  }
  revalidateMessage(commId);
  return { ok: "Rejected. Nothing was sent." };
}

export async function cancelAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const commId = String(fd.get("commId"));
  try {
    await outreach.cancelCommunication(a, commId, String(fd.get("reason") ?? "") || "Cancelled by operator");
  } catch (e) {
    const msg = expected(e);
    if (msg) return { error: msg };
    throw e;
  }
  revalidateMessage(commId);
  return { ok: "Cancelled. Nothing was sent." };
}

export async function retryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("approval:decide");
  const commId = String(fd.get("commId"));
  try {
    await outreach.retryCommunication({ id: op.id, role: op.role }, commId);
    const result = await dispatchCommunication(commId);
    revalidateMessage(commId);
    return result.status === "SENT" ? { ok: "Sent." } : { error: "status" in result && "reason" in result ? result.reason : `Not sent (${result.status}).` };
  } catch (e) {
    const msg = expected(e);
    if (msg) return { error: msg };
    throw e;
  }
}

export async function logInboundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  const channel = (["MAIL", "EMAIL", "INBOUND_PHONE_NOTE"] as const).find((c) => c === fd.get("channel")) ?? "INBOUND_PHONE_NOTE";
  try {
    await outreach.logInbound(a, {
      caseId,
      personId: String(fd.get("personId") ?? "") || null,
      channel,
      summary: String(fd.get("summary") ?? ""),
      optOut: fd.get("optOut") === "on",
    });
  } catch (e) {
    const msg = expected(e);
    if (msg) return { error: msg };
    throw e;
  }
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/approvals");
  return { ok: fd.get("optOut") === "on" ? "Logged. They are on the do-not-contact list and anything pending to them was cancelled." : "Logged. Pending follow-ups on this case were stopped." };
}
