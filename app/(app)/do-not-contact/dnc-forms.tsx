"use client";

import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { addDncAction, removeDncAction, type ActionState } from "./actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.ok) return <Alert tone="info">{state.ok}</Alert>;
  return null;
}

export function AddDncForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addDncAction, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field id="name" label="Name" />
      <Field id="email" label="Email" type="email" />
      <Field id="address" label="Street address with ZIP" placeholder="123 Main St, Reno, NV 89501" />
      <Field id="reason" label="Reason" required placeholder="Asked by phone not to be contacted" />
      <div className="sm:col-span-2 space-y-2">
        <Button type="submit" disabled={pending}>
          Add to do-not-contact list
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function RemoveDncForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(removeDncAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="text-xs">
        <span className="sr-only">Reason to remove</span>
        <input name="reason" required minLength={10} placeholder="Reason (10+ characters)" className="rounded border border-slate-300 px-2 py-1 text-sm" />
      </label>
      <Button type="submit" variant="secondary" disabled={pending} className="px-2 py-1">
        Remove
      </Button>
      {state.error ? <span className="text-sm text-red-800">{state.error}</span> : null}
    </form>
  );
}
