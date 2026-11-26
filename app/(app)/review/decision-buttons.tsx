"use client";

import { useActionState } from "react";
import { Alert, Button } from "@/components/ui";
import { decideMatch, type ReviewState } from "./actions";

export function DecisionButtons({ candidateId }: { candidateId: string }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(decideMatch, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="candidateId" value={candidateId} />
      {state.error ? <Alert>{state.error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="MERGE" disabled={pending}>
          Same person — merge
        </Button>
        <Button type="submit" name="decision" value="SEPARATE" variant="secondary" disabled={pending}>
          Different people
        </Button>
      </div>
    </form>
  );
}
