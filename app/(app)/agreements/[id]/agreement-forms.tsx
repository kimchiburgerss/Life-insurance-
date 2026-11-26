"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { approveAgreementAction, cancelAgreementAction, rejectAgreementAction, retryAgreementAction, type ActionState } from "../actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.ok) return <Alert tone="info">{state.ok}</Alert>;
  return null;
}

export function ApproveAgreementForm({ id, contentHash, allGreen, hasEmail, esignReady }: { id: string; contentHash: string; allGreen: boolean; hasEmail: boolean; esignReady: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(approveAgreementAction, {});
  const canEsign = hasEmail && esignReady;
  return (
    <form action={action} className="space-y-3 rounded-md border border-slate-300 p-4">
      <input type="hidden" name="agreementId" value={id} />
      <input type="hidden" name="contentHash" value={contentHash} />
      <fieldset className="space-y-1 text-sm">
        <legend className="font-medium">How will the heir sign?</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="method" value="ESIGN" defaultChecked={canEsign} disabled={!canEsign} /> Electronically (e-signature email)
          {!canEsign ? <span className="text-slate-500">— {hasEmail ? "no e-signature service" : "no email on file"}</span> : null}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="method" value="PAPER" defaultChecked={!canEsign} /> On paper (you print and mail it)
        </label>
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" disabled={!allGreen} required />
        <span>I have read this whole agreement and approve sending exactly this version to the signer shown.</span>
      </label>
      <Button type="submit" disabled={!allGreen || pending}>
        {pending ? "Approving…" : "Approve and send agreement"}
      </Button>
      {!allGreen ? <p className="text-sm text-red-800">Every check must be green before you can approve.</p> : null}
      <Result state={state} />
    </form>
  );
}

export function RejectAgreementForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(rejectAgreementAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="agreementId" value={id} />
      <label htmlFor="reject-reason" className="block text-sm font-medium">
        Reject with a reason
      </label>
      <input id="reject-reason" name="reason" required minLength={5} className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <Button type="submit" variant="secondary" disabled={pending}>
        Reject
      </Button>
      <Result state={state} />
    </form>
  );
}

export function CancelAgreementForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelAgreementAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="agreementId" value={id} />
      <label htmlFor="cancel-reason" className="block text-sm font-medium">
        Cancel (reason)
      </label>
      <input id="cancel-reason" name="reason" className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="e.g. Heir wants to file themselves" />
      <Button type="submit" variant="secondary" disabled={pending}>
        Cancel agreement
      </Button>
      <Result state={state} />
    </form>
  );
}

export function RetryAgreementForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(retryAgreementAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="agreementId" value={id} />
      <Button type="submit" disabled={pending}>
        Try sending again
      </Button>
      <Result state={state} />
    </form>
  );
}

export function PaperSignatureForm({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch(`/api/agreements/${id}/paper-signature`, { method: "POST", body: fd }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { ok?: boolean; error?: string } | undefined;
    setBusy(false);
    if (res?.ok && body?.ok) {
      setState({ ok: "Recorded as signed." });
      router.refresh();
    } else setState({ error: body?.error ?? "Upload failed." });
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm font-medium">
        Signed copy (PDF or photo)
        <input name="file" type="file" required accept="application/pdf,image/*" className="mt-1 block w-full text-sm" />
      </label>
      <label className="block text-sm font-medium">
        Date the heir signed
        <input name="signedOn" type="date" required className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <Button type="submit" disabled={busy}>
        Record paper signature
      </Button>
      <Result state={state} />
    </form>
  );
}
