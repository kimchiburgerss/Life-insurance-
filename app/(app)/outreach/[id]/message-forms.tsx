"use client";

import { useActionState, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { approveAction, cancelAction, rejectAction, retryAction, updateNoteAction, type ActionState } from "../actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.ok) return <Alert tone="info">{state.ok}</Alert>;
  return null;
}

const area = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

export function NoteEditor({ commId, initial }: { commId: string; initial: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateNoteAction, {});
  const [note, setNote] = useState(initial);
  return (
    <form
      action={() => {
        const fd = new FormData();
        fd.set("commId", commId);
        fd.set("personalNote", note);
        action(fd);
      }}
      className="space-y-2"
    >
      <label htmlFor="personalNote" className="block text-sm font-medium">
        Personal note (written by AI — edit freely)
      </label>
      <textarea id="personalNote" rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} className={area} />
      <p className="text-xs text-slate-600">The rest of the message is fixed template text. Saving re-runs the tone check and the checklist.</p>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Checking…" : "Save note"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function ApproveForm({ commId, contentHash, allGreen, channel }: { commId: string; contentHash: string; allGreen: boolean; channel: "MAIL" | "EMAIL" }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(approveAction, {});
  const what = channel === "MAIL" ? "letter" : "email";
  return (
    <form action={action} className="space-y-3 rounded-md border border-slate-300 p-4">
      <input type="hidden" name="commId" value={commId} />
      <input type="hidden" name="contentHash" value={contentHash} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" disabled={!allGreen} required />
        <span>I have read this whole {what} and approve sending it exactly as shown to the recipient shown.</span>
      </label>
      <Button type="submit" disabled={!allGreen || pending}>
        {pending ? "Approving…" : `Approve and send ${what}`}
      </Button>
      {!allGreen ? <p className="text-sm text-red-800">Every checklist item must be green before you can approve.</p> : null}
      <Result state={state} />
    </form>
  );
}

export function RejectForm({ commId }: { commId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(rejectAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="commId" value={commId} />
      <label htmlFor="reject-reason" className="block text-sm font-medium">
        Reject with a reason
      </label>
      <input id="reject-reason" name="reason" required minLength={5} className={area} placeholder="e.g. Wrong person — different middle name" />
      <Button type="submit" variant="secondary" disabled={pending}>
        Reject
      </Button>
      <Result state={state} />
    </form>
  );
}

export function CancelForm({ commId }: { commId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="commId" value={commId} />
      <input type="hidden" name="reason" value="Cancelled by operator" />
      <Button type="submit" variant="secondary" disabled={pending}>
        Cancel this message
      </Button>
      <Result state={state} />
    </form>
  );
}

export function RetryForm({ commId }: { commId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(retryAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="commId" value={commId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Retry sending (same approved content)"}
      </Button>
      <Result state={state} />
    </form>
  );
}
