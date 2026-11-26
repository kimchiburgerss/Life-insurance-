"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { runUnlockNow } from "./actions";

export function RunUnlockButton() {
  const [state, action, pending] = useActionState(runUnlockNow, {});
  return (
    <form action={action} className="flex items-center gap-2 text-sm">
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Checking…" : "Run today's unlock check now"}
      </Button>
      {state.ok ? <span role="status">{state.ok}</span> : null}
    </form>
  );
}
