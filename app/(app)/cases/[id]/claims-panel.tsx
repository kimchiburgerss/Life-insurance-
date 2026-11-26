"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import { createPacketAction, heirPaymentAction, type ActionState } from "../../claims/actions";

export type PacketRow = { id: string; claimant: string; status: string; created: string; claimNumber: string | null };
export type InvoiceRow = { id: string; heir: string; amount: string; status: string; created: string };
export type BillableAgreement = { id: string; heir: string; reference: string; hasInvoice: boolean };

export function ClaimsPanel({ caseId, canWrite, canStart, signedHeirs, packets }: { caseId: string; canWrite: boolean; canStart: boolean; signedHeirs: { id: string; name: string }[]; packets: PacketRow[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createPacketAction, {});
  return (
    <div className="space-y-3">
      {packets.length ? (
        <ul className="space-y-1 text-sm">
          {packets.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <Link href={`/claims/${p.id}`} className="underline">Packet for {p.claimant}</Link>
              <Badge tone={p.status === "APPROVED_BY_STATE" ? "good" : p.status === "DENIED_BY_STATE" ? "bad" : "neutral"}>{p.status.toLowerCase().replaceAll("_", " ")}</Badge>
              <span className="text-slate-500">{p.created}{p.claimNumber ? ` · claim ${p.claimNumber}` : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">No claim packet yet.</p>
      )}
      {canWrite && canStart && signedHeirs.length ? (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="caseId" value={caseId} />
          <label className="text-sm font-medium">
            Claimant
            <select name="personId" className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {signedHeirs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
          <Button type="submit" variant="secondary" disabled={pending}>Start claim packet</Button>
          {state.error ? <div className="w-full"><Alert>{state.error}</Alert></div> : null}
        </form>
      ) : null}
    </div>
  );
}

export function BillingPanel({ caseId, canApprove, canRecord, agreements, invoices, today }: { caseId: string; canApprove: boolean; canRecord: boolean; agreements: BillableAgreement[]; invoices: InvoiceRow[]; today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(heirPaymentAction, {});
  const open = agreements.filter((a) => !a.hasInvoice);
  const field = "mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <div className="space-y-3">
      {invoices.length ? (
        <ul className="space-y-1 text-sm">
          {invoices.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2">
              <Link href={`/invoices/${i.id}`} className="underline">{i.amount} — {i.heir}</Link>
              <Badge tone={i.status === "PAID" ? "good" : i.status === "OPEN" ? "warn" : i.status === "DRAFT" ? "neutral" : "bad"}>{i.status.toLowerCase()}</Badge>
              <span className="text-slate-500">{i.created}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">No invoices yet. After the State pays the heir, record the payment here.</p>
      )}
      {canApprove && canRecord && open.length ? (
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="caseId" value={caseId} />
          <label className="text-sm font-medium">
            Agreement
            <select name="agreementId" className={field}>{open.map((a) => <option key={a.id} value={a.id}>{a.reference} — {a.heir}</option>)}</select>
          </label>
          <label className="text-sm font-medium">
            Amount the State paid the heir ($)
            <input name="amount" inputMode="decimal" required className={field} />
          </label>
          <label className="text-sm font-medium">
            Date paid
            <input type="date" name="paidOn" defaultValue={today} className={field} />
          </label>
          <label className="text-sm font-medium">
            How you know
            <input name="evidence" required className={field} placeholder="e.g. Heir sent the State's payment letter" />
          </label>
          <div className="sm:col-span-2 space-y-2">
            <Button type="submit" disabled={pending}>Record payment and prepare invoice</Button>
            {state.error ? <Alert>{state.error}</Alert> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
