"use client";

import { useActionState } from "react";
import { Alert, Button } from "@/components/ui";
import type { TransitionPreview } from "@/lib/case/transitions";
import { moveCase, type TransitionState } from "../actions";

function label(stage: string) {
  return stage.toLowerCase().replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

function Option(props: {
  caseId: string;
  option: TransitionPreview;
  canOverride: boolean;
  action: (fd: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  const { option } = props;
  const blocked = option.blocks.length > 0;
  const closing = option.to.startsWith("CLOSED_");
  const showOverride = blocked && option.overridable && props.canOverride;
  const disabled = props.pending || !option.allowedForRole || (blocked && !showOverride);

  return (
    <li className="rounded-md border border-slate-200 p-3">
      <form action={props.action} className="space-y-2">
        <input type="hidden" name="caseId" value={props.caseId} />
        <input type="hidden" name="to" value={option.to} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant={closing ? "secondary" : "primary"} disabled={disabled}>
            {`Move to ${label(option.to)}`}
          </Button>
          {!option.allowedForRole ? <span className="text-sm text-slate-600">Your role can&apos;t make this move.</span> : null}
          {!blocked && option.allowedForRole ? <span className="text-sm text-emerald-800">All checks pass.</span> : null}
        </div>
        {blocked ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
            {option.blocks.map((b) => (
              <li key={b.code}>
                {b.message} {b.overridable ? <em className="text-slate-600">(OWNER can override with a reason)</em> : <strong>(cannot be overridden)</strong>}
              </li>
            ))}
          </ul>
        ) : null}
        {showOverride ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="override" className="mt-1" />
            <span>Override — I&apos;ve checked this myself. The reason below is recorded in the audit log.</span>
          </label>
        ) : null}
        {(closing || showOverride) && option.allowedForRole ? (
          <label className="block text-sm">
            <span className="block font-medium">{showOverride ? "Reason (required for an override, 10+ characters)" : "Reason"}</span>
            <input name="reason" className="mt-1 w-full max-w-xl rounded-md border border-slate-300 px-2 py-1" />
          </label>
        ) : null}
        {props.error ? <Alert>{props.error}</Alert> : null}
      </form>
    </li>
  );
}

/**
 * One action state for the whole panel: after a successful move the options
 * change (the case is at a new stage), so the confirmation must live here,
 * not inside the option that was clicked.
 */
export function TransitionPanel({ caseId, options, canOverride }: { caseId: string; options: TransitionPreview[]; canOverride: boolean }) {
  const [state, action, pending] = useActionState<TransitionState, FormData>(moveCase, {});
  return (
    <div className="space-y-3">
      {state.ok ? <Alert tone="info">{state.ok}</Alert> : null}
      {options.length === 0 ? (
        <p className="text-sm text-slate-600">This case is closed.</p>
      ) : (
        <ul className="space-y-3">
          {options.map((o) => (
            <Option
              key={o.to}
              caseId={caseId}
              option={o}
              canOverride={canOverride}
              action={action}
              pending={pending}
              error={state.error && state.to === o.to ? state.error : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
