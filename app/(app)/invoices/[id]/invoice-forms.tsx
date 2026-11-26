"use client";

import { useActionState } from "react";
import { Alert, Button } from "@/components/ui";
import { approveInvoiceAction, markPaidAction, retryInvoiceAction, voidInvoiceAction, type ActionState } from "../../claims/actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.ok) return <Alert tone="info">{state.ok}</Alert>;
  return null;
}
const field = "mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm";

export function ApproveInvoiceForm({ id, contentHash, hasEmail, onlineReady }: { id: string; contentHash: string; hasEmail: boolean; onlineReady: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(approveInvoiceAction, {});
  const online = hasEmail && onlineReady;
  return (
    <form action={action} className="space-y-3 rounded-md border border-slate-300 p-4">
      <input type="hidden" name="invoiceId" value={id} />
      <input type="hidden" name="contentHash" value={contentHash} />
      <fieldset className="space-y-1 text-sm">
        <legend className="font-medium">How should the heir receive it?</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="method" value="STRIPE" defaultChecked={online} disabled={!online} /> Online invoice by email (pay by card or bank)
          {!online ? <span className="text-slate-500">— {hasEmail ? "no payment service" : "no email on file"}</span> : null}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="method" value="MANUAL" defaultChecked={!online} /> Paper invoice you send yourself
        </label>
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" required /> The amount, the recipient and the reminders (7, 14 and 30 days if unpaid) are correct — send it.
      </label>
      <Button type="submit" disabled={pending}>
        Approve and send invoice
      </Button>
      <Result state={state} />
    </form>
  );
}

export function RetryInvoiceForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(retryInvoiceAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="invoiceId" value={id} />
      <Button type="submit" disabled={pending}>Try sending again</Button>
      <Result state={state} />
    </form>
  );
}

export function MarkPaidForm({ id, today }: { id: string; today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(markPaidAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="invoiceId" value={id} />
      <label className="text-sm font-medium">
        Paid on
        <input type="date" name="paidOn" defaultValue={today} className={field} />
      </label>
      <label className="text-sm font-medium">
        How (e.g. check number)
        <input name="note" className={field} />
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>Mark paid</Button>
      <div className="w-full"><Result state={state} /></div>
    </form>
  );
}

export function VoidInvoiceForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(voidInvoiceAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="invoiceId" value={id} />
      <label className="text-sm font-medium">
        Reason
        <input name="reason" className={field} />
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>Void invoice</Button>
      <div className="w-full"><Result state={state} /></div>
    </form>
  );
}
