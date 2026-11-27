/**
 * THE ONLY MODULE THAT TALKS TO THE PAYMENTS PROVIDER. Sends an approved
 * invoice, re-sends reminders at 7/14/30 days, voids, applies verified Stripe
 * events, and (demo only) simulates a payment. A database trigger refuses an
 * OPEN or PAID invoice without a matching approval.
 */
import "server-only";
import { writeAudit } from "@/lib/audit";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import { transitionCase } from "@/lib/case/transitions";
import { prisma } from "@/lib/db";
import { addDays, dateInNevada, toDateOnly, todayIn } from "@/lib/dates";
import type { Role } from "@/lib/generated/prisma/enums";
import { notifyCase } from "@/lib/notifications";
import { getPaymentsProvider, MockPaymentsProvider } from "@/adapters/payments";
import type { StripeInvoiceEvent } from "@/adapters/payments/webhook";
import { BillingError, DAYS_UNTIL_DUE, invoiceHash, markInvoicePaid, recipientFor, REMINDER_DAYS, type BillingActor } from "./service";

export class InvoiceSendRefused extends Error {
  constructor(message: string) {
    super(`Not sent: ${message}`);
    this.name = "InvoiceSendRefused";
  }
}

type Event = { at: string; type: string; detail?: string; eventId?: string };
const appendEvent = (events: unknown, e: Omit<Event, "at">): Event[] => [...((Array.isArray(events) ? events : []) as Event[]), { at: new Date().toISOString(), ...e }].slice(-100);
const GATEWAY = { type: "SYSTEM" as const, id: "billing-gateway" };

export async function dispatchInvoice(id: string): Promise<{ status: "SENT"; method: "STRIPE" | "MANUAL" } | { status: "FAILED"; reason: string }> {
  const inv = await prisma.invoice.findUnique({ where: { id } });
  if (!inv) throw new InvoiceSendRefused("invoice not found.");
  if (inv.status !== "DRAFT" || !inv.approvalId || !inv.contentHash || !inv.personId) throw new InvoiceSendRefused("the invoice is not approved and waiting to be sent.");
  const approval = await prisma.approval.findUnique({ where: { id: inv.approvalId }, include: { approvedBy: { select: { role: true } } } });
  if (!approval || approval.subjectType !== "INVOICE" || approval.subjectId !== inv.id || approval.decision !== "APPROVED") throw new InvoiceSendRefused("there is no approval for this invoice.");
  if (!can((approval.approvedBy.role ?? "VIEWER") as Role, "approval:decide")) throw new InvoiceSendRefused("the approver is not allowed to approve invoices.");
  const recipient = await recipientFor(prisma, inv.personId);
  const hash = invoiceHash({ recipient, amountCents: inv.amountCents, currency: inv.currency, description: inv.description ?? "", agreementId: inv.agreementId });
  if (hash !== approval.contentHash || hash !== inv.contentHash) throw new InvoiceSendRefused("the amount or recipient differs from what was approved.");

  const manual = inv.provider === "manual";
  const claimed = await prisma.invoice.updateMany({ where: { id, status: "DRAFT", provider: manual ? "manual" : "pending:stripe" }, data: { provider: manual ? "manual:sending" : "stripe:sending" } });
  if (claimed.count !== 1) throw new InvoiceSendRefused("it is already being sent.");
  try {
    let data: { provider: string; stripeInvoiceId?: string | null; stripeCustomerId?: string | null; paymentLinkUrl?: string | null; dueDate: Date };
    if (manual) {
      data = { provider: "manual", dueDate: addDays(todayIn(), DAYS_UNTIL_DUE) };
    } else {
      const payments = getPaymentsProvider();
      if (!payments) throw new Error("No payment service is configured.");
      if (!recipient.email) throw new Error("The heir has no email address.");
      const r = await payments.sendInvoice({ invoiceId: inv.id, customer: { name: recipient.name, email: recipient.email }, amountCents: inv.amountCents, currency: inv.currency, description: inv.description ?? "", daysUntilDue: DAYS_UNTIL_DUE });
      data = { provider: payments.id, stripeInvoiceId: r.providerInvoiceId, stripeCustomerId: r.customerId, paymentLinkUrl: r.hostedUrl, dueDate: r.dueDate ? toDateOnly(new Date(`${r.dueDate}T00:00:00Z`)) : addDays(todayIn(), DAYS_UNTIL_DUE) };
    }
    await prisma.invoice.update({ where: { id }, data: { ...data, status: "OPEN", issuedAt: new Date(), events: appendEvent(inv.events, { type: "sent", detail: data.provider }) as never } });
    await writeAudit(prisma, { actor: GATEWAY, action: "invoice.sent", entityType: "Invoice", entityId: id, after: { approvalId: approval.id, amountCents: inv.amountCents, provider: data.provider, providerInvoiceId: data.stripeInvoiceId ?? null } });
    const c = await prisma.case.findUniqueOrThrow({ where: { id: inv.caseId }, select: { stage: true } });
    if (c.stage === "PAID_TO_HEIR") {
      await transitionCase({ caseId: inv.caseId, to: "FEE_INVOICED", actor: GATEWAY, reason: "Approved invoice sent." }).catch(() => undefined);
    }
    return { status: "SENT", method: manual ? "MANUAL" : "STRIPE" };
  } catch (e) {
    const detail = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.invoice.update({ where: { id }, data: { provider: manual ? "manual" : "pending:stripe", events: appendEvent(inv.events, { type: "send_failed", detail }) as never } });
    await writeAudit(prisma, { actor: GATEWAY, action: "invoice.send_failed", entityType: "Invoice", entityId: id, reason: detail });
    return { status: "FAILED", reason: detail };
  }
}

/** Daily: re-send open online invoices at 7, 14 and 30 days; remind the owner about manual ones. */
export async function sendDueReminders(today: Date = todayIn()): Promise<{ sent: number; manual: number }> {
  const open = await prisma.invoice.findMany({ where: { status: "OPEN", issuedAt: { not: null } } });
  let sent = 0;
  let manual = 0;
  for (const inv of open) {
    const done = ((Array.isArray(inv.remindersSent) ? inv.remindersSent : []) as { day: number }[]).map((r) => r.day);
    const age = Math.floor((today.getTime() - dateInNevada(inv.issuedAt!).getTime()) / 86_400_000);
    const due = REMINDER_DAYS.filter((d) => age >= d && !done.includes(d));
    if (!due.length) continue;
    const day = due[due.length - 1]!;
    const record = [...((Array.isArray(inv.remindersSent) ? inv.remindersSent : []) as object[]), ...due.map((d) => ({ day: d, at: new Date().toISOString(), resent: d === day }))];
    if (inv.provider === "manual") {
      manual++;
      await prisma.invoice.update({ where: { id: inv.id }, data: { remindersSent: record as never } });
      await notifyCase(prisma, { caseId: inv.caseId, kind: "SYSTEM", title: `Manual invoice unpaid after ${day} days — follow up with the heir` });
      continue;
    }
    const payments = getPaymentsProvider();
    if (!payments || !inv.stripeInvoiceId) continue;
    try {
      await payments.sendReminder(inv.stripeInvoiceId);
      await prisma.invoice.update({ where: { id: inv.id }, data: { remindersSent: record as never, events: appendEvent(inv.events, { type: "reminder_sent", detail: `day ${day}` }) as never } });
      await writeAudit(prisma, { actor: GATEWAY, action: "invoice.reminder_sent", entityType: "Invoice", entityId: inv.id, after: { day } });
      sent++;
    } catch (e) {
      await prisma.invoice.update({ where: { id: inv.id }, data: { events: appendEvent(inv.events, { type: "reminder_failed", detail: e instanceof Error ? e.message.slice(0, 300) : String(e) }) as never } });
    }
  }
  return { sent, manual };
}

export async function voidInvoice(actor: BillingActor, id: string, reason: string) {
  if (!can(actor.role, "approval:decide")) throw new ForbiddenError("Only the OWNER can void an invoice.");
  if (reason.trim().length < 5) throw new BillingError("Give a reason for voiding.");
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  if (inv.status === "PAID" || inv.status === "VOID") throw new BillingError("This invoice can't be voided.");
  if (inv.status === "OPEN" && inv.stripeInvoiceId && inv.provider !== "manual") {
    const payments = getPaymentsProvider();
    if (payments) await payments.voidInvoice(inv.stripeInvoiceId);
  }
  await prisma.invoice.update({ where: { id }, data: { status: "VOID", statusReason: reason.trim().slice(0, 300), events: appendEvent(inv.events, { type: "voided", detail: reason.trim().slice(0, 300) }) as never } });
  await writeAudit(prisma, { actor: { type: "USER", id: actor.id, role: actor.role }, action: "invoice.voided", entityType: "Invoice", entityId: id, reason: reason.trim() });
}

/** Apply a verified Stripe event (idempotent per event id). */
export async function applyStripeEvent(ev: StripeInvoiceEvent): Promise<{ handled: boolean; duplicate?: boolean }> {
  const inv = ev.providerInvoiceId ? await prisma.invoice.findFirst({ where: { stripeInvoiceId: ev.providerInvoiceId } }) : null;
  if (!inv) return { handled: false };
  const events = (Array.isArray(inv.events) ? inv.events : []) as Event[];
  if (events.some((e) => e.eventId === ev.eventId)) return { handled: true, duplicate: true };
  if (ev.type === "PAID") {
    await prisma.invoice.update({ where: { id: inv.id }, data: { events: appendEvent(inv.events, { type: "stripe_paid", eventId: ev.eventId }) as never } });
    if (inv.status === "OPEN") await markInvoicePaid(inv.id, ev.occurredAt, { type: "SYSTEM", id: "stripe-webhook" }, "Paid online (Stripe)");
    return { handled: true };
  }
  const status = ev.type === "VOIDED" ? "VOID" : ev.type === "UNCOLLECTIBLE" ? "UNCOLLECTIBLE" : null;
  await prisma.invoice.update({
    where: { id: inv.id },
    data: { ...(status && inv.status === "OPEN" ? { status } : {}), events: appendEvent(inv.events, { type: ev.type.toLowerCase(), eventId: ev.eventId }) as never },
  });
  if (ev.type === "PAYMENT_FAILED") await notifyCase(prisma, { caseId: inv.caseId, kind: "SEND_FAILED", title: "An online fee payment failed" });
  return { handled: true };
}

/** DEMO ONLY (MOCK_MODE): the heir "pays" in the portal, standing in for Stripe's hosted page. */
export async function simulateMockPayment(invoiceId: string, personId: string) {
  if ((process.env.MOCK_MODE ?? "true") === "false") throw new ForbiddenError("Demo payments are only available in mock mode.");
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.personId !== personId || inv.status !== "OPEN" || inv.provider !== "mock-payments" || !inv.stripeInvoiceId) throw new InvoiceSendRefused("this invoice is not waiting for an online payment.");
  if (!MockPaymentsProvider.store.has(inv.stripeInvoiceId)) MockPaymentsProvider.store.set(inv.stripeInvoiceId, { req: { invoiceId: inv.id, customer: { name: "", email: "" }, amountCents: inv.amountCents, currency: inv.currency, description: "", daysUntilDue: 30 }, reminders: 0, voided: false });
  await applyStripeEvent({ eventId: `mock-paid-${inv.id}`, type: "PAID", providerInvoiceId: inv.stripeInvoiceId, invoiceId: inv.id, occurredAt: new Date() });
}
