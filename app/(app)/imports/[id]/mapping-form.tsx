"use client";

import { startTransition, useActionState, useState } from "react";
import { Alert, Badge, Button, Card } from "@/components/ui";
import type { ImportMapping } from "@/lib/import/fields";
import { previewMapping, startImport, type MappingState } from "../actions";

type FieldDef = { key: string; label: string; required: boolean };

export function MappingForm(props: {
  batchId: string;
  headers: string[];
  previewRows: Record<string, unknown>[];
  initial: ImportMapping;
  fields: FieldDef[];
  saved: { id: string; name: string; mapping: ImportMapping }[];
}) {
  const [fields, setFields] = useState<Record<string, string>>(props.initial.fields as Record<string, string>);
  const [nameOrder, setNameOrder] = useState(props.initial.options.nameOrder);
  const [dateOrder, setDateOrder] = useState(props.initial.options.dateOrder);
  const [caseFilter, setCaseFilter] = useState<"ALL" | "RELEVANT">(props.initial.options.caseFilter);
  const [previewState, previewAction, previewPending] = useActionState<MappingState, FormData>(previewMapping, {});
  const [startState, startAction, startPending] = useActionState<MappingState, FormData>(startImport, {});
  const [saveAs, setSaveAs] = useState("");
  const [confirmReportDate, setConfirmReportDate] = useState(false);
  const deliveryHeader = fields.dateDeliveredToState;

  // Submissions are built from React state rather than the <form> element:
  // React 19 resets a form after an action runs, which would blank the
  // controlled selects in the DOM while state still holds the mapping.
  function submit(act: (fd: FormData) => void) {
    const fd = new FormData();
    fd.set("batchId", props.batchId);
    for (const [k, v] of Object.entries(fields)) if (v) fd.set(`field:${k}`, v);
    fd.set("nameOrder", nameOrder);
    fd.set("dateOrder", dateOrder);
    fd.set("caseFilter", caseFilter);
    fd.set("saveAs", saveAs);
    if (confirmReportDate) fd.set("confirmReportDate", "on");
    startTransition(() => act(fd));
  }
  const needsConfirm = Boolean(deliveryHeader && /report/i.test(deliveryHeader));

  function applySaved(id: string) {
    const s = props.saved.find((x) => x.id === id);
    if (!s) return;
    const valid = Object.fromEntries(Object.entries(s.mapping.fields).filter(([, h]) => h && props.headers.includes(h)));
    setFields(valid as Record<string, string>);
    setNameOrder(s.mapping.options.nameOrder);
    setDateOrder(s.mapping.options.dateOrder);
    setCaseFilter(s.mapping.options.caseFilter ?? "ALL");
  }

  const error = startState.error ?? previewState.error;

  return (
    <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
      <Card title="1. Match the file's columns to our fields">
        {props.saved.length > 0 ? (
          <label className="mb-4 block text-sm">
            <span className="mr-2 font-medium">Use a saved mapping:</span>
            <select className="rounded-md border border-slate-300 px-2 py-1" defaultValue="" onChange={(e) => applySaved(e.target.value)}>
              <option value="">—</option>
              {props.saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {props.fields.map((f) => (
            <label key={f.key} className="text-sm">
              <span className="block font-medium">
                {f.label}
                {f.required ? <span className="text-red-700"> *</span> : null}
              </span>
              <select
                value={fields[f.key] ?? ""}
                onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1"
              >
                <option value="">— not in this file —</option>
                {props.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block font-medium">Single-column names are written as</span>
            <select value={nameOrder} onChange={(e) => setNameOrder(e.target.value as typeof nameOrder)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1">
              <option value="AUTO">Detect automatically (LAST FIRST is common in state files)</option>
              <option value="LAST_FIRST">LAST FIRST MIDDLE</option>
              <option value="FIRST_LAST">FIRST MIDDLE LAST</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-medium">Numeric dates are written as</span>
            <select value={dateOrder} onChange={(e) => setDateOrder(e.target.value as typeof dateOrder)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1">
              <option value="MDY">Month/Day/Year (US)</option>
              <option value="DMY">Day/Month/Year</option>
              <option value="YMD">Year-Month-Day</option>
            </select>
          </label>
        </div>
        <label className="mt-4 block text-sm">
          <span className="block font-medium">Which owners become cases?</span>
          <select value={caseFilter} onChange={(e) => setCaseFilter(e.target.value as "ALL" | "RELEVANT")} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 sm:w-auto">
            <option value="RELEVANT">Only life insurance, annuity and estate records, or names marked deceased (recommended for statewide lists)</option>
            <option value="ALL">Every owner in the file</option>
          </select>
          <span className="mt-1 block text-slate-600">All rows are imported either way; other owners are kept without a case and can be grouped later.</span>
        </label>
        {needsConfirm ? (
          <div className="mt-4">
            <Alert tone="warning">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={confirmReportDate} onChange={(e) => setConfirmReportDate(e.target.checked)} className="mt-1" />
                <span>
                  “{deliveryHeader}” looks like a <strong>report</strong> date. The 24-month rule runs from the date the
                  property was <strong>delivered</strong> to the state. Nevada holders usually report and remit together,
                  but confirm with the Unclaimed Property Division. Tick to confirm this column can be used.
                </span>
              </label>
            </Alert>
          </div>
        ) : null}
        <p className="mt-4 text-sm text-slate-600">
          A year-only or month-only date is stored as the last day of that year or month (the cautious choice for the
          waiting period and fee tier) and flagged as approximate.
        </p>
      </Card>

      <Card title="2. Check a preview">
        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="mb-1 text-left text-sm text-slate-600">First rows of the file as uploaded</caption>
            <thead>
              <tr>
                {props.headers.map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap border-b px-2 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.previewRows.slice(0, 5).map((r, i) => (
                <tr key={i}>
                  {props.headers.map((h) => (
                    <td key={h} className="whitespace-nowrap border-b border-slate-100 px-2 py-1">
                      {String(r[h] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button type="button" onClick={() => submit(previewAction)} variant="secondary" disabled={previewPending}>
          {previewPending ? "Checking…" : "Preview how rows will be imported"}
        </Button>
        {previewState.preview ? (
          <div className="mt-4 overflow-x-auto">
            <p className="mb-2 text-sm" role="status">
              {previewState.previewTotal} rows · {previewState.previewErrors} would be skipped with an error.
            </p>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-600">
                  <th scope="col" className="px-2 py-1">Row</th>
                  <th scope="col" className="px-2 py-1">Property ID</th>
                  <th scope="col" className="px-2 py-1">Owner (normalized)</th>
                  <th scope="col" className="px-2 py-1">Address</th>
                  <th scope="col" className="px-2 py-1">Type</th>
                  <th scope="col" className="px-2 py-1">Amount</th>
                  <th scope="col" className="px-2 py-1">Delivered to state</th>
                  <th scope="col" className="px-2 py-1">Flags</th>
                </tr>
              </thead>
              <tbody>
                {previewState.preview.map((r) =>
                  r.ok ? (
                    <tr key={r.row} className="border-t border-slate-100">
                      <td className="px-2 py-1">{r.row}</td>
                      <td className="px-2 py-1 font-mono">{r.propertyId}</td>
                      <td className="px-2 py-1">{r.owner}</td>
                      <td className="px-2 py-1">{r.address ?? "—"}</td>
                      <td className="px-2 py-1">{r.category?.toLowerCase().replace("_", " ")}</td>
                      <td className="px-2 py-1">{r.amount}</td>
                      <td className="px-2 py-1">{r.delivered}</td>
                      <td className="px-2 py-1">
                        <span className="flex flex-wrap gap-1">
                          {r.flags?.map((f) => (
                            <Badge key={f} tone={f === "ESTATE" || f === "DECEASED" ? "good" : "neutral"}>
                              {f.toLowerCase().replaceAll("_", " ")}
                            </Badge>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr key={r.row} className="border-t border-slate-100 text-red-800">
                      <td className="px-2 py-1">{r.row}</td>
                      <td className="px-2 py-1" colSpan={7}>
                        Skipped: {r.error}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card title="3. Import">
        {error ? (
          <div className="mb-3">
            <Alert>{error}</Alert>
          </div>
        ) : null}
        <label className="mb-3 block text-sm">
          <span className="block font-medium">Save this mapping for files with the same layout (optional)</span>
          <input value={saveAs} onChange={(e) => setSaveAs(e.target.value)} placeholder="e.g. NV Treasurer export 2026" className="mt-1 w-full max-w-md rounded-md border border-slate-300 px-2 py-1" />
        </label>
        <Button type="button" onClick={() => submit(startAction)} disabled={startPending}>
          {startPending ? "Starting…" : "Start import"}
        </Button>
        <p className="mt-2 text-sm text-slate-600">
          Properties already imported (same state property ID) are skipped. Possible duplicate owners go to the review
          queue; nothing is merged unless it is clearly the same person.
        </p>
      </Card>
    </form>
  );
}
