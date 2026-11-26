"use client";

import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import type { BusinessProfile } from "@/lib/outreach/settings";
import {
  clearCounselAction,
  recordCounselAction,
  saveAgreementOptionsAction,
  saveBusinessAction,
  saveOutreachAction,
  saveUnitCostsAction,
  toggleAttorneyAgreementAction,
  uploadAttorneyAgreementAction,
  type ActionState,
} from "./actions";

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

export function AgreementOptionsForm({ cancellationDays, bookingUrl, portalLinkDays, disabled }: { cancellationDays: number; bookingUrl: string; portalLinkDays: number; disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveAgreementOptionsAction, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-3">
      <Field id="cancellationDays" label="Cancellation window (days)" type="number" min={3} max={60} defaultValue={String(cancellationDays)} disabled={disabled} />
      <Field id="portalLinkDays" label="Portal links valid for (days)" type="number" min={30} max={730} defaultValue={String(portalLinkDays)} disabled={disabled} />
      <Field id="bookingUrl" label="Call booking link (optional)" defaultValue={bookingUrl} placeholder="https://" disabled={disabled} />
      <div className="sm:col-span-3 space-y-2">
        {disabled ? null : (
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        )}
        <Result state={state} />
      </div>
    </form>
  );
}

export function AttorneyAgreementForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadAttorneyAgreementAction, {});
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-slate-600">
        Upload the attorney-approved text as Markdown (.md) or paste it. It must keep the {"{{variables}}"} for the property list, values before and after the
        fee, fee %, delivery date and free-claim disclosure, and have a section about our services — the app checks this.
      </p>
      <label className="block text-sm font-medium">
        Markdown file
        <input name="file" type="file" accept=".md,.txt,text/markdown,text/plain" disabled={disabled} className="mt-1 block text-sm" />
      </label>
      <label className="block text-sm font-medium">
        …or paste the text
        <textarea name="text" rows={6} disabled={disabled} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="approvedBy" label="Attorney name and firm" disabled={disabled} />
        <Field id="approvedOn" label="Date approved" type="date" disabled={disabled} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" disabled={disabled} /> A licensed Nevada attorney approved this exact text.
      </label>
      {disabled ? null : (
        <Button type="submit" disabled={pending}>
          Upload attorney-approved agreement
        </Button>
      )}
      <Result state={state} />
    </form>
  );
}

export function ToggleAttorneyAgreementForm({ on, disabled }: { on: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(toggleAttorneyAgreementAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="use" defaultChecked={on} disabled={disabled} /> Use the attorney-approved agreement (removes the DRAFT marking)
      </label>
      {disabled ? null : (
        <Button type="submit" variant="secondary" disabled={pending}>
          Save
        </Button>
      )}
      <Result state={state} />
    </form>
  );
}

export function UnitCostsForm({ initial, disabled }: { initial: { perLetterCents: number; perDataLookupCents: number; perEsignCents: number; monthlyHostingCents: number }; disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveUnitCostsAction, {});
  const d = (c: number) => (c / 100).toFixed(2);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-4">
      <Field id="perLetter" label="Per letter ($)" defaultValue={d(initial.perLetterCents)} inputMode="decimal" disabled={disabled} />
      <Field id="perLookup" label="Per data lookup ($)" defaultValue={d(initial.perDataLookupCents)} inputMode="decimal" disabled={disabled} />
      <Field id="perEsign" label="Per e-signature ($)" defaultValue={d(initial.perEsignCents)} inputMode="decimal" disabled={disabled} />
      <Field id="monthlyHosting" label="Monthly hosting ($)" defaultValue={d(initial.monthlyHostingCents)} inputMode="decimal" disabled={disabled} />
      <div className="sm:col-span-4 space-y-2">
        {disabled ? null : <Button type="submit" disabled={pending}>Save costs</Button>}
        <Result state={state} />
      </div>
    </form>
  );
}
