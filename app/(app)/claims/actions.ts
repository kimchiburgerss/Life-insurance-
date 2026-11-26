"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { TransitionError } from "@/lib/case/transitions";
import { prisma } from "@/lib/db";
import { parseDateOnly } from "@/lib/dates";
import { FeeCapExceededError } from "@/lib/rules/engine";
import { AiOutputError } from "@/lib/ai/run";
import { AiRefusedError } from "@/lib/ai/provider";
import { decideAiRun, AiDecisionError } from "@/lib/ai/acceptance";
import { approvePacket, assemblePacketFor, AssemblyError, ClaimError, createPacket, recordFiling, recordOutcome, setItemDecision, updatePacketFacts } from "@/lib/claims/service";
import { reviewHeirDocument, ReviewError } from "@/lib/claims/review";
import { dispatchInvoice, InvoiceSendRefused, voidInvoice } from "@/lib/billing/gateway";
import { approveInvoice, BillingError, markPaidManually, recordHeirPayment } from "@/lib/billing/service";

export type ActionState = { ok?: string; error?: string };

function expected(e: unknown): string | null {
  if (
    e instanceof ClaimError ||
    e instanceof AssemblyError ||
    e instanceof ReviewError ||
    e instanceof BillingError ||
    e instanceof InvoiceSendRefused ||
    e instanceof FeeCapExceededError ||
    e instanceof ForbiddenError ||
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

async function run(paths: string[], fn: () => Promise<string>): Promise<ActionState> {
  try {
    const ok = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok };
  } catch (e) {
    const msg = expected(e);
    if (msg) return { error: msg };
    throw e;
  }
}

async function op(permission: "case:write" | "approval:decide" = "case:write") {
  const o = await requireOperator(permission);
  return { id: o.id, role: o.role };
}

export async function createPacketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op();
  let id = "";
  const r = await run([`/cases/${fd.get("caseId")}`], async () => {
    id = (await createPacket(a, { caseId: String(fd.get("caseId")), personId: String(fd.get("personId")) })).id;
    return "Packet started.";
  });
  if (r.error) return r;
  redirect(`/claims/${id}`);
}

export async function factsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op();
  const id = String(fd.get("packetId"));
  const tri = (v: FormDataEntryValue | null) => (v === "yes" ? true : v === "no" ? false : null);
  return run([`/claims/${id}`], async () => {
    await updatePacketFacts(a, id, {
      estatePath: fd.get("estatePath") === "SMALL_ESTATE" ? "SMALL_ESTATE" : fd.get("estatePath") === "PROBATE" ? "PROBATE" : null,
      hasWill: tri(fd.get("hasWill")),
      multipleHeirs: fd.get("multipleHeirs") === "yes",
    });
    return "Saved. The document list was updated.";
  });
}

export async function decisionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op();
  const id = String(fd.get("packetId"));
  const status = fd.get("status") === "WAIVED" ? "WAIVED" : fd.get("status") === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : null;
  return run([`/claims/${id}`], async () => {
    await setItemDecision(a, id, { key: String(fd.get("key")), status, reason: String(fd.get("reason") ?? "") });
    return status ? "Recorded." : "Cleared.";
  });
}

export async function reviewDocAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op();
  const id = String(fd.get("packetId"));
  return run([`/claims/${id}`], async () => {
    const r = await reviewHeirDocument(a, String(fd.get("documentId")));
    return r.flags.length ? `Review done — ${r.flags.length} thing(s) to check.` : "Review done.";
  });
}

export async function docStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op();
  const id = String(fd.get("packetId"));
  const decision = fd.get("decision") === "ACCEPTED" ? "ACCEPTED" : "NEEDS_REPLACEMENT";
  const note = String(fd.get("note") ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (decision === "NEEDS_REPLACEMENT" && note.length < 5) return { error: "Tell the heir what to send instead (they see this note)." };
  return run([`/claims/${id}`], async () => {
    const doc = await prisma.heirDocument.update({ where: { id: String(fd.get("documentId")) }, data: { status: decision, reviewNote: decision === "ACCEPTED" ? null : note, reviewedById: a.id, reviewedAt: new Date() } });
    await prisma.claimPacket.updateMany({ where: { id, status: "READY_FOR_REVIEW" }, data: { status: "IN_PROGRESS", assembledPdfKey: null, contentHash: null } });
    await writeAudit(prisma, { actor: { type: "USER", id: a.id, role: a.role }, action: "document.reviewed", entityType: "HeirDocument", entityId: doc.id, after: { decision } });
    const runId = String(fd.get("aiRunId") ?? "");
    if (runId) {
      const ai = await prisma.aiRun.findUnique({ where: { id: runId }, select: { acceptance: true } });
      if (ai?.acceptance === "PENDING") await decideAiRun(prisma, { aiRunId: runId, decision: decision === "ACCEPTED" ? "ACCEPTED" : "REJECTED", actor: a, note: `Document ${decision.toLowerCase()}` });
    }
    return decision === "ACCEPTED" ? "Accepted." : "The heir will see your note.";
  });
}

export async function assembleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op();
  const id = String(fd.get("packetId"));
  return run([`/claims/${id}`], async () => `Assembled: ${(await assemblePacketFor(a, id)).pages} pages.`);
}

export async function approvePacketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op("approval:decide");
  const id = String(fd.get("packetId"));
  return run([`/claims/${id}`, "/approvals"], async () => {
    await approvePacket(a, id, { contentHash: String(fd.get("contentHash") ?? ""), confirmed: fd.get("confirm") === "on" });
    return "Approved. Download it and file it with the heir.";
  });
}

export async function filingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op("approval:decide");
  const id = String(fd.get("packetId"));
  const on = String(fd.get("filedOn") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return { error: "Enter the filing date." };
  return run([`/claims/${id}`], async () => {
    await recordFiling(a, id, { filedOn: parseDateOnly(on), method: fd.get("method") === "MAIL" ? "MAIL" : "ONLINE", claimNumber: String(fd.get("claimNumber") ?? "") });
    return "Filing recorded.";
  });
}

export async function outcomeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op("approval:decide");
  const id = String(fd.get("packetId"));
  const on = String(fd.get("on") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return { error: "Enter the date of the decision." };
  const outcome = (["APPROVED", "DENIED", "MORE_INFO"] as const).find((o) => o === fd.get("outcome"));
  if (!outcome) return { error: "Choose the decision." };
  return run([`/claims/${id}`], async () => {
    await recordOutcome(a, id, { outcome, on: parseDateOnly(on), note: String(fd.get("note") ?? "") });
    return "Decision recorded.";
  });
}

export async function heirPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op("approval:decide");
  const dollars = String(fd.get("amount") ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(dollars)) return { error: "Enter the amount paid, e.g. 12345.67" };
  const cents = Math.round(Number(dollars) * 100);
  const on = String(fd.get("paidOn") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return { error: "Enter the date the heir was paid." };
  let id = "";
  const r = await run([`/cases/${fd.get("caseId")}`], async () => {
    id = (await recordHeirPayment(a, { agreementId: String(fd.get("agreementId")), amountPaidCents: cents, paidOn: parseDateOnly(on), evidence: String(fd.get("evidence") ?? "") })).id;
    return "Recorded.";
  });
  if (r.error) return r;
  redirect(`/invoices/${id}`);
}

export async function approveInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op("approval:decide");
  const id = String(fd.get("invoiceId"));
  const method = fd.get("method") === "MANUAL" ? "MANUAL" : "STRIPE";
  return run([`/invoices/${id}`, "/approvals"], async () => {
    await approveInvoice(a, id, { contentHash: String(fd.get("contentHash") ?? ""), confirmed: fd.get("confirm") === "on", method });
    const r = await dispatchInvoice(id);
    if (r.status === "FAILED") throw new BillingError(`Approved, but not sent: ${r.reason}`);
    return method === "MANUAL" ? "Approved. Send the heir your paper invoice." : "Approved and sent.";
  });
}

export async function retryInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await op("approval:decide");
  const id = String(fd.get("invoiceId"));
  return run([`/invoices/${id}`], async () => {
    const r = await dispatchInvoice(id);
    if (r.status === "FAILED") throw new BillingError(r.reason);
    return "Sent.";
  });
}

export async function markPaidAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op("approval:decide");
  const id = String(fd.get("invoiceId"));
  const on = String(fd.get("paidOn") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return { error: "Enter the date it was paid." };
  return run([`/invoices/${id}`], async () => {
    await markPaidManually(a, id, { paidOn: parseDateOnly(on), note: String(fd.get("note") ?? "") });
    return "Marked paid.";
  });
}

export async function voidInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await op("approval:decide");
  const id = String(fd.get("invoiceId"));
  return run([`/invoices/${id}`], async () => {
    await voidInvoice(a, id, String(fd.get("reason") ?? ""));
    return "Voided.";
  });
}
