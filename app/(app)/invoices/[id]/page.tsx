import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDateOnly, formatNevadaDate, todayIn } from "@/lib/dates";
import { caseRef, formatUsd } from "@/lib/format";
import { formatBps } from "@/lib/rules/engine";
import { invoiceHash, recipientFor } from "@/lib/billing/service";
import { paymentsProviderStatus } from "@/adapters/payments/status";
import { ApproveInvoiceForm, MarkPaidForm, RetryInvoiceForm, VoidInvoiceForm } from "./invoice-forms";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const operator = await requireOperator("case:read");
  const { id } = await params;
  const inv = await prisma.invoice.findUnique({ where: { id }, include: { case: { select: { id: true, caseNumber: true, stateCode: true, owner: { select: { fullName: true } } } } } });
  if (!inv) notFound();
  const recipient = inv.personId ? await recipientFor(prisma, inv.personId) : { name: "?", email: null };
  const currentHash = invoiceHash({ recipient, amountCents: inv.amountCents, currency: inv.currency, description: inv.description ?? "", agreementId: inv.agreementId });
  const approval = inv.approvalId ? await prisma.approval.findUnique({ where: { id: inv.approvalId }, include: { approvedBy: { select: { name: true } } } }) : null;
  const canApprove = can(operator.role, "approval:decide");
  const events = (Array.isArray(inv.events) ? inv.events : []) as { at: string; type: string; detail?: string }[];
  const reminders = (Array.isArray(inv.remindersSent) ? inv.remindersSent : []) as { day: number; at: string }[];
  const today = formatDateOnly(todayIn());

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href={`/cases/${inv.case.id}`} className="underline">{caseRef(inv.case.caseNumber, inv.case.stateCode)}</Link> / invoice
        </p>
        <h1 className="text-2xl font-semibold">Fee invoice — {formatUsd(inv.amountCents, { exact: true })}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={inv.status === "PAID" ? "good" : inv.status === "OPEN" ? "warn" : inv.status === "DRAFT" ? "neutral" : "bad"}>{inv.status.toLowerCase()}</Badge>
          <span className="text-slate-600">Estate of {inv.case.owner.fullName} · to {recipient.name}{recipient.email ? ` <${recipient.email}>` : " (no email)"}</span>
        </p>
      </div>
      {inv.status === "DRAFT" && inv.approvalId ? <Alert>Approved but not sent yet. {events.at(-1)?.type === "send_failed" ? events.at(-1)?.detail : ""}</Alert> : null}
      {inv.status === "OPEN" ? <Alert tone="info">Sent {formatNevadaDate(inv.issuedAt)} ({inv.provider}); due {inv.dueDate ? formatDateOnly(inv.dueDate) : "?"}.{inv.paymentLinkUrl ? <> <a href={inv.paymentLinkUrl} className="underline" rel="noopener noreferrer">Payment page</a></> : null}</Alert> : null}
      {inv.status === "PAID" ? <Alert tone="info">Paid {formatNevadaDate(inv.paidAt)}. Thank you!</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="How the fee was worked out">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-slate-600">Paid to the heir by the State</dt><dd className="tabular-nums">{formatUsd(inv.amountPaidToHeirCents, { exact: true })}{inv.paidToHeirAt ? ` on ${formatDateOnly(inv.paidToHeirAt)}` : ""}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-600">Fee in the signed agreement</dt><dd className="tabular-nums">{inv.feeBps != null ? formatBps(inv.feeBps) : "?"}</dd></div>
            <div className="flex justify-between gap-2 font-semibold"><dt>Fee (rounded down)</dt><dd className="tabular-nums">{formatUsd(inv.amountCents, { exact: true })}</dd></div>
            <div><dt className="text-slate-600">How we know they were paid</dt><dd>{inv.paymentEvidence}</dd></div>
            <div><dt className="text-slate-600">Invoice text</dt><dd>{inv.description}</dd></div>
          </dl>
        </Card>
        <div className="space-y-6">
          {inv.status === "DRAFT" && !inv.approvalId && canApprove ? (
            <Card title="Approve">
              {currentHash !== inv.contentHash ? (
                <Alert>The heir&apos;s contact details changed since this invoice was prepared. Void it and record the payment again.</Alert>
              ) : (
                <ApproveInvoiceForm id={inv.id} contentHash={currentHash} hasEmail={Boolean(recipient.email)} onlineReady={paymentsProviderStatus().ok} />
              )}
            </Card>
          ) : null}
          {inv.status === "DRAFT" && inv.approvalId && canApprove ? <Card title="Send"><RetryInvoiceForm id={inv.id} /></Card> : null}
          {inv.status === "OPEN" && canApprove ? (
            <Card title="Paid another way?">
              <MarkPaidForm id={inv.id} today={today} />
            </Card>
          ) : null}
          {(inv.status === "DRAFT" || inv.status === "OPEN") && canApprove ? (
            <Card title="Void">
              <VoidInvoiceForm id={inv.id} />
            </Card>
          ) : null}
          {approval ? (
            <Card title="Approval record">
              <p className="text-sm">Approved by <strong>{approval.approvedBy.name}</strong> at {approval.createdAt.toISOString().slice(0, 19).replace("T", " ")} UTC ({approval.reason}).</p>
            </Card>
          ) : null}
          {reminders.length ? (
            <Card title="Reminders">
              <ul className="text-sm">{reminders.map((r) => <li key={r.day}>Day {r.day}: {r.at.slice(0, 10)}</li>)}</ul>
            </Card>
          ) : null}
          {events.length ? (
            <Card title="Events">
              <ol className="space-y-1 text-sm">
                {events.map((e, n) => (
                  <li key={n}><span className="font-mono text-xs text-slate-500">{e.at.slice(0, 16).replace("T", " ")}</span> {e.type.replaceAll("_", " ")}{e.detail ? <span className="text-slate-600"> — {e.detail}</span> : null}</li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
