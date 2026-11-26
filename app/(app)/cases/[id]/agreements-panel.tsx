"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import { createAgreementAction, portalLinkAction, reviewDocumentAction, type ActionState } from "../../agreements/actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.ok) return <Alert tone="info">{state.ok}</Alert>;
  return null;
}

export type AgreementRowView = { id: string; reference: string; signer: string; status: string; method: string | null; created: string };

export function AgreementsPanel(props: {
  caseId: string;
  canWrite: boolean;
  canPrepare: string | null;
  heirs: { id: string; name: string }[];
  defaultFeePercent: number;
  capPercent: number | null;
  agreements: AgreementRowView[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createAgreementAction, {});
  return (
    <div className="space-y-4">
      {props.agreements.length ? (
        <table className="w-full text-left text-sm">
          <thead className="text-slate-600">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">Agreement</th>
              <th scope="col" className="py-1 pr-3 font-medium">Signer</th>
              <th scope="col" className="py-1 pr-3 font-medium">Created</th>
              <th scope="col" className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {props.agreements.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="py-1 pr-3">
                  <Link href={`/agreements/${a.id}`} className="underline">{a.reference}</Link>
                </td>
                <td className="py-1 pr-3">{a.signer}</td>
                <td className="py-1 pr-3">{a.created}</td>
                <td className="py-1">
                  <Badge tone={a.status === "SIGNED" ? "good" : a.status === "PENDING_APPROVAL" ? "warn" : ["DECLINED", "VOIDED"].includes(a.status) ? "bad" : "neutral"}>
                    {a.status.toLowerCase().replaceAll("_", " ")}
                    {a.method ? ` · ${a.method === "PAPER" ? "paper" : "e-sign"}` : ""}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-slate-600">No agreements yet.</p>
      )}
      {props.canPrepare ? <Alert tone="info">{props.canPrepare}</Alert> : null}
      {props.canWrite && !props.canPrepare && props.heirs.length ? (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="caseId" value={props.caseId} />
          <label className="text-sm font-medium">
            Heir
            <select name="personId" className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {props.heirs.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Fee %
            <input name="feePercent" defaultValue={props.defaultFeePercent} inputMode="decimal" className="mt-1 block w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Generating…" : "Prepare agreement"}
          </Button>
          <span className="text-xs text-slate-600">Legal cap for this case: {props.capPercent != null ? `${props.capPercent}%` : "unknown"} — a higher fee is refused.</span>
          <div className="w-full">
            <Result state={state} />
          </div>
        </form>
      ) : null}
    </div>
  );
}

export type DocView = { id: string; heir: string; item: string; fileName: string; status: string; note: string | null; uploaded: string; url: string };

function ReviewDoc({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewDocumentAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="documentId" value={id} />
      <Button type="submit" name="decision" value="ACCEPTED" variant="secondary" className="px-2 py-1" disabled={pending}>
        Looks good
      </Button>
      <input name="note" placeholder="What to send instead" className="rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Note to the heir" />
      <Button type="submit" name="decision" value="NEEDS_REPLACEMENT" variant="secondary" className="px-2 py-1" disabled={pending}>
        Ask for a new copy
      </Button>
      {state.error ? <span className="text-sm text-red-800">{state.error}</span> : state.ok ? <span className="text-sm text-emerald-800">{state.ok}</span> : null}
    </form>
  );
}

export function DocumentsPanel({ docs, canWrite }: { docs: DocView[]; canWrite: boolean }) {
  if (!docs.length) return <p className="text-sm text-slate-600">No documents uploaded yet. Heirs upload them from their portal page.</p>;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {docs.map((d) => (
        <li key={d.id} className="space-y-1 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{d.item}</span>
            <span className="text-slate-600">from {d.heir}, {d.uploaded}</span>
            <a href={d.url} className="underline" target="_blank" rel="noopener noreferrer">{d.fileName}</a>
            <Badge tone={d.status === "ACCEPTED" ? "good" : d.status === "NEEDS_REPLACEMENT" ? "warn" : "neutral"}>{d.status.toLowerCase().replaceAll("_", " ")}</Badge>
          </div>
          {d.note ? <p className="text-amber-900">Note to heir: {d.note}</p> : null}
          {canWrite && d.status === "RECEIVED" ? <ReviewDoc id={d.id} /> : null}
        </li>
      ))}
    </ul>
  );
}

export type PortalLinkView = { personId: string; name: string; access: { id: string; url: string; expires: string; lastUsed: string | null } | null };

function PortalLinkRow({ caseId, row }: { caseId: string; row: PortalLinkView }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(portalLinkAction, {});
  return (
    <li className="space-y-1 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{row.name}</span>
        {row.access ? (
          <>
            <code className="break-all rounded bg-slate-100 px-1 text-xs">{row.access.url}</code>
            <span className="text-xs text-slate-600">expires {row.access.expires}{row.access.lastUsed ? `, last opened ${row.access.lastUsed}` : ", not opened yet"}</span>
          </>
        ) : (
          <span className="text-slate-600">No active link (one is created with the first letter).</span>
        )}
      </div>
      <form action={action} className="flex gap-2">
        <input type="hidden" name="caseId" value={caseId} />
        <input type="hidden" name="personId" value={row.personId} />
        {row.access ? (
          <>
            <input type="hidden" name="accessId" value={row.access.id} />
            <Button type="submit" name="op" value="revoke" variant="secondary" className="px-2 py-1" disabled={pending}>Revoke link</Button>
          </>
        ) : (
          <Button type="submit" name="op" value="create" variant="secondary" className="px-2 py-1" disabled={pending}>Create link</Button>
        )}
      </form>
      {state.error ? <p className="text-sm text-red-800">{state.error}</p> : null}
    </li>
  );
}

export function PortalLinksPanel({ caseId, rows, canWrite }: { caseId: string; rows: PortalLinkView[]; canWrite: boolean }) {
  if (!rows.length) return <p className="text-sm text-slate-600">No heirs yet.</p>;
  if (!canWrite) return <p className="text-sm text-slate-600">{rows.filter((r) => r.access).length} active portal link(s).</p>;
  return <ul className="divide-y divide-slate-100 text-sm">{rows.map((r) => <PortalLinkRow key={r.personId} caseId={caseId} row={r} />)}</ul>;
}
