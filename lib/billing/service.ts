/**
 * Billing (spec 5.9). After the State pays the heir, the OWNER records the
 * amount paid (from the heir's or the State's confirmation); the fee is the
 * signed agreement's percentage of THAT amount, rounded down, and never above
 * the agreement's percentage or its legal cap. The invoice is a draft until the
 * OWNER approves the exact recipient and amount; only lib/billing/gateway.ts
 * sends it.
 */
import "server-only";
import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import { transitionCase } from "@/lib/case/transitions";
import { decryptPii } from "@/lib/crypto/pii";
import { prisma, type DbClient } from "@/lib/db";
import { formatDateOnly, toDateOnly, todayIn } from "@/lib/dates";
import type { Role } from "@/lib/generated/prisma/enums";
import { notifyCase } from "@/lib/notifications";
import { agreementReference } from "@/lib/agreements/service";
import { formatExactUsd } from "@/lib/outreach/content";
import { assertFeeWithinCap, feeBreakdown, formatBps } from "@/lib/rules/engine";

export class BillingError extends Error {}
export type BillingActor = { id: string; role: Role };

export const DAYS_UNTIL_DUE = 30;
export const REMINDER_DAYS = [7, 14, 30] as const;

function requireOwner(a: BillingActor, what: string) {
  if (!can(a.role, "approval:decide")) throw new ForbiddenError(`Only the OWNER can ${what}.`);
}

export type Recipient = { name: string; email: string | null };

export function invoiceHash(i: { recipient: Recipient; amountCents: number; currency: string; description: string; agreementId: string | null }): string {
  return createHash("sha256").update(JSON.stringify(["INVOICE", i.recipient.name, (i.recipient.email ?? "").toLowerCase(), i.amountCents, i.currency, i.description, i.agreementId ?? ""])).digest("hex");
}

/** Fee owed on what the heir actually received (pure; rounds down in the heir's favour). */
export function feeOnPayment(amountPaidCents: number, agreement: { feeBps: number; feeCapBps: number | null }): number {
  assertFeeWithinCap(agreement.feeBps, agreement.feeCapBps ?? agreement.feeBps);
  return feeBreakdown(amountPaidCents, agreement.feeBps).feeCents;
}

export async function recipientFor(db: DbClient, personId: string): Promise<Recipient> {
  const p = await db.person.findUniqueOrThrow({ where: { id: personId } });
  return { name: p.fullName, email: p.emailEnc ? decryptPii(p.emailEnc) : null };
}

/** Record what the State paid the heir and prepare the (draft) invoice for our fee. */
export async function recordHeirPayment(actor: BillingActor, input: { agreementId: string; amountPaidCents: number; paidOn: Date; evidence: string }) {
  requireOwner(actor, "record a payment to the heir");
  if (!Number.isInteger(input.amountPaidCents) || input.amountPaidCents <= 0) throw new BillingError("Enter the amount the State paid, in dollars and cents.");
  const evidence = input.evidence.trim().slice(0, 500);
  if (evidence.length < 5) throw new BillingError("Say how you know (e.g. \"Heir emailed the State's payment letter\").");
  const a = await prisma.agreement.findUniqueOrThrow({ where: { id: input.agreementId }, include: { case: { select: { id: true, stage: true } } } });
  if (a.status !== "SIGNED" || !a.personId) throw new BillingError("Only a signed agreement can be billed.");
  if (!["CLAIM_APPROVED", "PAID_TO_HEIR", "FEE_INVOICED", "FEE_COLLECTED"].includes(a.case.stage)) throw new BillingError("Record the payment after the State approves the claim.");
  const paidOn = toDateOnly(input.paidOn);
  if (paidOn > todayIn()) throw new BillingError("The payment date can't be in the future.");
  if (a.signedAt && paidOn < toDateOnly(a.signedAt)) throw new BillingError("The payment date is before the agreement was signed.");
  if (await prisma.invoice.findFirst({ where: { agreementId: a.id, status: { not: "VOID" } } })) throw new BillingError("This agreement already has an invoice. Void it first if the amount was wrong.");
  const fee = feeOnPayment(input.amountPaidCents, a);
  if (fee <= 0) throw new BillingError("The fee on this amount is zero; nothing to invoice.");
  const recipient = await recipientFor(prisma, a.personId);
  const description =
    `Recovery services fee: ${formatBps(a.feeBps)} of ${formatExactUsd(input.amountPaidCents)} paid to you by the State of Nevada on ${formatDateOnly(paidOn)} ` +
    `(agreement ${agreementReference(a)}).`;
  const invoice = await prisma.invoice.create({
    data: {
      caseId: a.caseId,
      agreementId: a.id,
      personId: a.personId,
      amountPaidToHeirCents: input.amountPaidCents,
      paidToHeirAt: paidOn,
      paymentEvidence: evidence,
      feeBps: a.feeBps,
      amountCents: fee,
      description,
      contentHash: invoiceHash({ recipient, amountCents: fee, currency: "usd", description, agreementId: a.id }),
      createdById: actor.id,
    },
  });
  await writeAudit(prisma, {
    actor: { type: "USER", id: actor.id, role: actor.role },
    action: "billing.heir_payment_recorded",
    entityType: "Invoice",
    entityId: invoice.id,
    after: { agreementId: a.id, amountPaidToHeirCents: input.amountPaidCents, paidOn: formatDateOnly(paidOn), feeBps: a.feeBps, feeCents: fee },
    reason: evidence,
  });
  if (a.case.stage === "CLAIM_APPROVED") {
    await transitionCase({ caseId: a.caseId, to: "PAID_TO_HEIR", actor: { type: "USER", id: actor.id, role: actor.role }, reason: `State paid the heir ${formatExactUsd(input.amountPaidCents)} on ${formatDateOnly(paidOn)}.` });
  }
  return invoice;
}

/** OWNER approves the exact recipient + amount and how it is sent. */
export async function approveInvoice(actor: BillingActor, id: string, input: { contentHash: string; confirmed: boolean; method: "STRIPE" | "MANUAL" }) {
  requireOwner(actor, "approve an invoice");
  if (!input.confirmed) throw new BillingError("Tick the box to confirm the amount and recipient.");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status !== "DRAFT" || inv.approvalId) throw new BillingError("This invoice is not waiting for approval.");
    const recipient = await recipientFor(tx, inv.personId!);
    const hash = invoiceHash({ recipient, amountCents: inv.amountCents, currency: inv.currency, description: inv.description ?? "", agreementId: inv.agreementId });
    if (hash !== inv.contentHash || hash !== input.contentHash) throw new BillingError("The invoice or the heir's contact details changed. Reload and review it again.");
    if (input.method === "STRIPE" && !recipient.email) throw new BillingError("The heir has no email for an online invoice. Choose a manual (paper) invoice or add their email.");
    const approval = await tx.approval.create({
      data: {
        subjectType: "INVOICE",
        subjectId: inv.id,
        decision: "APPROVED",
        contentHash: hash,
        contentSnapshot: `${recipient.name} — ${formatExactUsd(inv.amountCents)} — ${inv.description}`,
        reason: input.method === "STRIPE" ? `Online invoice (reminders at ${REMINDER_DAYS.join("/")} days if unpaid)` : "Manual (paper) invoice",
        approvedById: actor.id,
      },
    });
    await tx.invoice.update({ where: { id }, data: { approvalId: approval.id, provider: input.method === "STRIPE" ? "pending:stripe" : "manual" } });
    await writeAudit(tx, { actor: { type: "USER", id: actor.id, role: actor.role }, action: "invoice.approved", entityType: "Invoice", entityId: id, after: { approvalId: approval.id, amountCents: inv.amountCents, method: input.method } });
    return approval;
  });
}

/**
 * Mark an approved invoice paid. When every issued invoice on the case is
 * paid, the case moves to FEE_COLLECTED.
 */
export async function markInvoicePaid(invoiceId: string, paidAt: Date, source: { type: "USER"; id: string; role: Role } | { type: "SYSTEM"; id: string }, detail: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.status === "PAID") return false;
  if (inv.status !== "OPEN") throw new BillingError("Only an open (sent) invoice can be marked paid.");
  const events = [...((Array.isArray(inv.events) ? inv.events : []) as object[]), { at: new Date().toISOString(), type: "paid", detail }];
  await prisma.invoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt, events: events as never } });
  await writeAudit(prisma, { actor: source, action: "invoice.paid", entityType: "Invoice", entityId: inv.id, after: { amountCents: inv.amountCents, paidAt: paidAt.toISOString(), detail } });
  await notifyCase(prisma, { caseId: inv.caseId, kind: "INVOICE_PAID", title: `Fee paid: ${formatExactUsd(inv.amountCents)}` });
  const unpaid = await prisma.invoice.count({ where: { caseId: inv.caseId, status: "OPEN" } });
  const c = await prisma.case.findUniqueOrThrow({ where: { id: inv.caseId }, select: { stage: true } });
  if (unpaid === 0 && c.stage === "FEE_INVOICED") {
    await transitionCase({ caseId: inv.caseId, to: "FEE_COLLECTED", actor: source.type === "USER" ? source : { type: "SYSTEM", id: source.id }, reason: "All fees paid." });
  }
  return true;
}

export async function markPaidManually(actor: BillingActor, id: string, input: { paidOn: Date; note: string }) {
  requireOwner(actor, "mark an invoice paid");
  const note = input.note.trim();
  if (note.length < 3) throw new BillingError("Note how it was paid (e.g. \"check #1042\").");
  if (toDateOnly(input.paidOn) > todayIn()) throw new BillingError("The date can't be in the future.");
  await markInvoicePaid(id, toDateOnly(input.paidOn), { type: "USER", id: actor.id, role: actor.role }, `Recorded by owner: ${note}`);
}
