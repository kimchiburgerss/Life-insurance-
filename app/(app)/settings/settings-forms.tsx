"use client";

import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import type { BusinessProfile } from "@/lib/outreach/settings";
import { clearCounselAction, recordCounselAction, saveBusinessAction, saveOutreachAction, type ActionState } from "./actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.ok) return <Alert tone="info">{state.ok}</Alert>;
  return null;
}

export function BusinessForm({ initial, disabled }: { initial: BusinessProfile | null; disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBusinessAction, {});
  const a = initial?.mailingAddress;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field id="legalName" label="Business legal name" defaultValue={initial?.legalName} required disabled={disabled} />
      <Field id="website" label="Website (optional)" defaultValue={initial?.website} placeholder="https://" disabled={disabled} />
      <Field id="contactName" label="Contact person (a real person heirs can reach)" defaultValue={initial?.contactName} required disabled={disabled} />
      <Field id="contactTitle" label="Their title (optional)" defaultValue={initial?.contactTitle} disabled={disabled} />
      <Field id="phone" label="Phone a real person answers" defaultValue={initial?.phone} required disabled={disabled} />
      <Field id="email" label="Email (sends and receives replies)" type="email" defaultValue={initial?.email} required disabled={disabled} />
      <Field id="line1" label="Mailing address" defaultValue={a?.line1} required disabled={disabled} />
      <Field id="line2" label="Suite / unit (optional)" defaultValue={a?.line2} disabled={disabled} />
      <Field id="city" label="City" defaultValue={a?.city} required disabled={disabled} />
      <div className="grid grid-cols-2 gap-4">
        <Field id="state" label="State" defaultValue={a?.state ?? "NV"} maxLength={2} required disabled={disabled} />
        <Field id="zip" label="ZIP" defaultValue={a?.zip} required disabled={disabled} />
      </div>
      <div className="sm:col-span-2 space-y-2">
        <p className="text-sm text-slate-600">
          Printed on every letter and email. The postal address is required by CAN-SPAM for email and is the return address on letters.
        </p>
        {disabled ? null : (
          <Button type="submit" disabled={pending}>
            Save business profile
          </Button>
        )}
        <Result state={state} />
      </div>
    </form>
  );
}

export function OutreachForm({ feePercent, sendingPaused, disabled }: { feePercent: number; sendingPaused: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveOutreachAction, {});
  return (
    <form action={action} className="space-y-3">
      <Field id="feePercent" label="Fee quoted in letters (%)" defaultValue={String(feePercent)} inputMode="decimal" disabled={disabled} hint="Always capped by the legal fee cap for each case (10% / 20% tiers in Jurisdiction rules)." />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="sendingPaused" defaultChecked={sendingPaused} disabled={disabled} /> Pause all sending (approved messages wait)
      </label>
      {disabled ? null : (
        <Button type="submit" disabled={pending}>
          Save outreach settings
        </Button>
      )}
      <Result state={state} />
    </form>
  );
}

export function CounselForm({ versions, disabled }: { versions: Record<string, string>; disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(recordCounselAction, {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="approvedBy" label="Attorney name and firm" required disabled={disabled} />
        <Field id="approvedOn" label="Date approved" type="date" required disabled={disabled} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" disabled={disabled} />
        <span>
          Nevada counsel reviewed and approved these exact template versions:{" "}
          {Object.entries(versions)
            .map(([id, v]) => `${id}@${v}`)
            .join(", ")}
          .
        </span>
      </label>
      {disabled ? null : (
        <Button type="submit" disabled={pending}>
          Record counsel approval
        </Button>
      )}
      <Result state={state} />
    </form>
  );
}

export function ClearCounselForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(clearCounselAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field id="reason" label="Reason to clear" />
      <Button type="submit" variant="secondary" disabled={pending}>
        Clear approval
      </Button>
      <Result state={state} />
    </form>
  );
}
