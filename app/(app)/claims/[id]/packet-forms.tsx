"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Alert, Button } from "@/components/ui";
import {
  approvePacketAction,
  assembleAction,
  decisionAction,
  docStatusAction,
  factsAction,
  filingAction,
  outcomeAction,
  reviewDocAction,
  type ActionState,
} from "../actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.ok) return <Alert tone="info">{state.ok}</Alert>;
  return null;
}
const sel = "mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm";

export function FactsForm({ packetId, facts, disabled }: { packetId: string; facts: { estatePath: string | null; hasWill: boolean | null; multipleHeirs: boolean; spouseClaimant: boolean }; disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(factsAction, {});
  const tri = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "");
  return (
    <form action={action} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="packetId" value={packetId} />
      <label className="text-sm font-medium">
        Estate
        <select name="estatePath" defaultValue={facts.estatePath ?? ""} className={sel} disabled={disabled}>
          <option value="">Not confirmed yet</option>
          <option value="SMALL_ESTATE">Small estate, not probated</option>
          <option value="PROBATE">Probate (court) — or over the limit</option>
        </select>
      </label>
      <label className="text-sm font-medium">
        Will or trust?
        <select name="hasWill" defaultValue={tri(facts.hasWill)} className={sel} disabled={disabled}>
          <option value="">Not known</option>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </label>
      <label className="text-sm font-medium">
        Other heirs releasing to this claimant?
        <select name="multipleHeirs" defaultValue={facts.multipleHeirs ? "yes" : "no"} className={sel} disabled={disabled}>
          <option value="no">No — sole heir</option>
          <option value="yes">Yes</option>
        </select>
      </label>
      {facts.spouseClaimant ? <span className="text-sm text-slate-600">Claimant is the surviving spouse.</span> : null}
      {disabled ? null : (
        <Button type="submit" variant="secondary" disabled={pending}>
          Save facts
        </Button>
      )}
      <div className="w-full">
        <Result state={state} />
      </div>
    </form>
  );
}

export function ItemDecision({ packetId, itemKey, current, canWaive }: { packetId: string; itemKey: string; current: string | null; canWaive: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(decisionAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="packetId" value={packetId} />
      <input type="hidden" name="key" value={itemKey} />
      {current ? (
        <Button type="submit" name="status" value="" variant="secondary" className="px-2 py-1 text-xs" disabled={pending}>
          Undo
        </Button>
      ) : (
        <>
          <input name="reason" placeholder="Reason" aria-label="Reason" className="rounded border border-slate-300 px-2 py-1 text-xs" />
          <Button type="submit" name="status" value="NOT_APPLICABLE" variant="secondary" className="px-2 py-1 text-xs" disabled={pending}>
            Not needed
          </Button>
          {canWaive ? (
            <Button type="submit" name="status" value="WAIVED" variant="secondary" className="px-2 py-1 text-xs" disabled={pending}>
              Waive
            </Button>
          ) : null}
        </>
      )}
      {state.error ? <span className="text-xs text-red-800">{state.error}</span> : null}
    </form>
  );
}

export function DocActions({ packetId, documentId, aiRunId, showReview }: { packetId: string; documentId: string; aiRunId: string | null; showReview: boolean }) {
  const [rState, review, reviewing] = useActionState<ActionState, FormData>(reviewDocAction, {});
  const [sState, decide, deciding] = useActionState<ActionState, FormData>(docStatusAction, {});
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showReview ? (
        <form action={review}>
          <input type="hidden" name="packetId" value={packetId} />
          <input type="hidden" name="documentId" value={documentId} />
          <Button type="submit" variant="secondary" className="px-2 py-1 text-xs" disabled={reviewing}>
            {reviewing ? "Reviewing…" : "Check with AI"}
          </Button>
        </form>
      ) : null}
      <form action={decide} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="packetId" value={packetId} />
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="aiRunId" value={aiRunId ?? ""} />
        <Button type="submit" name="decision" value="ACCEPTED" variant="secondary" className="px-2 py-1 text-xs" disabled={deciding}>
          Accept
        </Button>
        <input name="note" placeholder="What to send instead" aria-label="Note to the heir" className="rounded border border-slate-300 px-2 py-1 text-xs" />
        <Button type="submit" name="decision" value="NEEDS_REPLACEMENT" variant="secondary" className="px-2 py-1 text-xs" disabled={deciding}>
          Ask for a new copy
        </Button>
      </form>
      {rState.error || sState.error ? <span className="text-xs text-red-800">{rState.error ?? sState.error}</span> : rState.ok ? <span className="text-xs text-emerald-800">{rState.ok}</span> : null}
    </div>
  );
}

export function OperatorUpload({ packetId, items }: { packetId: string; items: { key: string; label: string }[] }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/claims/${packetId}/documents`, { method: "POST", body: new FormData(e.currentTarget) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { ok?: boolean; error?: string } | undefined;
    setBusy(false);
    if (res?.ok && body?.ok) {
      setState({ ok: "Uploaded." });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } else setState({ error: body?.error ?? "Upload failed." });
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium">
        Item
        <select name="checklistKey" className={sel}>
          {items.map((i) => (
            <option key={i.key} value={i.key}>
              {i.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">
        File (PDF or photo)
        <input name="file" type="file" required accept="application/pdf,image/*" className="mt-1 block text-sm" />
      </label>
      <Button type="submit" variant="secondary" disabled={busy}>
        Upload
      </Button>
      <div className="w-full">
        <Result state={state} />
      </div>
    </form>
  );
}

export function AssembleForm({ packetId, ready }: { packetId: string; ready: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(assembleAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="packetId" value={packetId} />
      <Button type="submit" disabled={!ready || pending}>
        {pending ? "Assembling…" : "Assemble packet PDF"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function ApprovePacketForm({ packetId, contentHash }: { packetId: string; contentHash: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(approvePacketAction, {});
  return (
    <form action={action} className="space-y-3 rounded-md border border-slate-300 p-4">
      <input type="hidden" name="packetId" value={packetId} />
      <input type="hidden" name="contentHash" value={contentHash} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" required /> I checked every page of this packet and approve it for filing.
      </label>
      <Button type="submit" disabled={pending}>
        Approve packet
      </Button>
      <Result state={state} />
    </form>
  );
}

export function FilingForm({ packetId, today }: { packetId: string; today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(filingAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="packetId" value={packetId} />
      <label className="text-sm font-medium">
        Filed on
        <input type="date" name="filedOn" defaultValue={today} className={sel} />
      </label>
      <label className="text-sm font-medium">
        How
        <select name="method" className={sel}>
          <option value="ONLINE">Online (State claim site)</option>
          <option value="MAIL">By mail</option>
        </select>
      </label>
      <label className="text-sm font-medium">
        State claim ID
        <input name="claimNumber" className={sel} />
      </label>
      <Button type="submit" disabled={pending}>
        Record filing
      </Button>
      <div className="w-full">
        <Result state={state} />
      </div>
    </form>
  );
}

export function OutcomeForm({ packetId, today }: { packetId: string; today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(outcomeAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="packetId" value={packetId} />
      <label className="text-sm font-medium">
        Decision
        <select name="outcome" className={sel}>
          <option value="APPROVED">Approved</option>
          <option value="MORE_INFO">More information requested</option>
          <option value="DENIED">Denied</option>
        </select>
      </label>
      <label className="text-sm font-medium">
        Date
        <input type="date" name="on" defaultValue={today} className={sel} />
      </label>
      <label className="text-sm font-medium">
        What the State said
        <input name="note" className={`${sel} w-72`} />
      </label>
      <Button type="submit" disabled={pending}>
        Record decision
      </Button>
      <div className="w-full">
        <Result state={state} />
      </div>
    </form>
  );
}
