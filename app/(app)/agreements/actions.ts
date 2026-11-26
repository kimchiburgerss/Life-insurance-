"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/auth/permissions";
import { requestIp, requireOperator } from "@/lib/auth/session";
import { TransitionError } from "@/lib/case/transitions";
import { prisma } from "@/lib/db";
import { FeeCapExceededError } from "@/lib/rules/engine";
import { AgreementSendRefused, cancelAgreement, dispatchAgreement } from "@/lib/agreements/gateway";
import { AgreementContentError, AgreementError, AgreementPdfError, approveAgreement, createAgreement, rejectAgreement } from "@/lib/agreements/service";
import { ensurePortalAccess, revokePortalAccess } from "@/lib/portal/access";

export type ActionState = { ok?: string; error?: string };

function expected(e: unknown): string | null {
  if (
    e instanceof AgreementError ||
    e instanceof AgreementContentError ||
    e instanceof AgreementPdfError ||
    e instanceof AgreementSendRefused ||
    e instanceof FeeCapExceededError ||
    e instanceof ForbiddenError ||
    e instanceof TransitionError
  ) {
    return e.message;
  }
  if (e instanceof Error && (e.name === "RuleNotFoundError" || e.name === "RangeError")) return e.message;
  return null;
}

export async function createAgreementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("case:write");
  const caseId = String(fd.get("caseId"));
  const pct = String(fd.get("feePercent") ?? "").trim();
  const feeBps = pct ? Math.round(Number(pct.replace("%", "")) * 100) : undefined;
  if (feeBps !== undefined && !Number.isFinite(feeBps)) return { error: "Enter the fee as a percentage, e.g. 10." };
  let id: string;
  try {
    id = (await createAgreement({ id: op.id, role: op.role }, { caseId, personId: String(fd.get("personId")), feeBps })).id;
  } catch (e) {
    const msg = expected(e);
    if (msg) return { error: msg };
    throw e;
  }
  revalidatePath(`/cases/${caseId}`);
  redirect(`/agreements/${id}`);
}

export async function approveAgreementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("approval:decide");
  const id = String(fd.get("agreementId"));
  const method = fd.get("method") === "PAPER" ? "PAPER" : "ESIGN";
  try {
    await approveAgreement({ id: op.id, role: op.role }, id, { contentHash: String(fd.get("contentHash") ?? ""), confirmed: fd.get("confirm") === "on", method, ipAddress: await requestIp() });
    const r = await dispatchAgreement(id);
    revalidatePath(`/agreements/${id}`);
    revalidatePath("/approvals");
    if (r.status === "FAILED") return { error: `Approved, but not sent: ${r.reason}` };
    return { ok: method === "PAPER" ? "Approved. Download it, print it and mail it for signature." : "Approved and sent for electronic signature." };
  } catch (e) {
    const msg = expected(e);
    if (msg) {
      revalidatePath(`/agreements/${id}`);
      return { error: msg };
    }
    throw e;
  }
}

export async function retryAgreementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireOperator("approval:decide");
  const id = String(fd.get("agreementId"));
  try {
    const r = await dispatchAgreement(id);
    revalidatePath(`/agreements/${id}`);
    return r.status === "SENT" ? { ok: "Sent." } : { error: "reason" in r ? r.reason : `Not sent (${r.status}).` };
  } catch (e) {
    const msg = expected(e);
    if (msg) return { error: msg };
    throw e;
  }
}

export async function rejectAgreementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("approval:decide");
  const id = String(fd.get("agreementId"));
  try {
    await rejectAgreement({ id: op.id, role: op.role }, id, String(fd.get("reason") ?? ""));
  } catch (e) {
    const msg = expected(e);
    if (msg) return { error: msg };
    throw e;
  }
  revalidatePath(`/agreements/${id}`);
  revalidatePath("/approvals");
  return { ok: "Rejected. Nothing was sent." };
}

export async function cancelAgreementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("case:write");
  const id = String(fd.get("agreementId"));
  const reason = String(fd.get("reason") ?? "").trim() || "Cancelled by operator";
  try {
    await cancelAgreement({ id: op.id, role: op.role }, id, reason);
  } catch (e) {
    const msg = expected(e);
    if (msg) return { error: msg };
    throw e;
  }
  revalidatePath(`/agreements/${id}`);
  return { ok: "Cancelled." };
}

export async function reviewDocumentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("case:write");
  const id = String(fd.get("documentId"));
  const decision = fd.get("decision") === "ACCEPTED" ? "ACCEPTED" : "NEEDS_REPLACEMENT";
  const note = String(fd.get("note") ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (decision === "NEEDS_REPLACEMENT" && note.length < 5) return { error: "Tell the heir what to send instead (they will see this note)." };
  const doc = await prisma.heirDocument.update({ where: { id }, data: { status: decision, reviewNote: decision === "ACCEPTED" ? null : note, reviewedById: op.id, reviewedAt: new Date() } });
  await writeAudit(prisma, { actor: { type: "USER", id: op.id, role: op.role }, action: "document.reviewed", entityType: "HeirDocument", entityId: id, after: { decision, caseId: doc.caseId } });
  revalidatePath(`/cases/${doc.caseId}`);
  return { ok: decision === "ACCEPTED" ? "Marked as checked." : "The heir will see your note and can upload a new copy." };
}

export async function portalLinkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("case:write");
  const caseId = String(fd.get("caseId"));
  const personId = String(fd.get("personId"));
  if (fd.get("op") === "revoke") {
    const accessId = String(fd.get("accessId"));
    await revokePortalAccess(op, accessId, "Revoked by operator");
    revalidatePath(`/cases/${caseId}`);
    return { ok: "Link revoked. Letters already sent with it no longer open the portal; a new link is made with the next letter." };
  }
  const access = await ensurePortalAccess(prisma, { caseId, personId, createdById: op.id });
  revalidatePath(`/cases/${caseId}`);
  return { ok: `Portal link: ${access.url}` };
}
