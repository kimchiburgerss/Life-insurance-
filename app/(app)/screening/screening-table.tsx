"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert, Badge, Button, Card, ScrollRegion } from "@/components/ui";
import { caseRef, formatUsd, scoreTone } from "@/lib/format";
import { bulkScreen, type BulkState } from "../cases/actions";

type Row = {
  id: string;
  caseNumber: number;
  owner: string;
  score: number | null;
  explanation: string | null;
  expectedValueCents: number | null;
  estimatedValueCents: number | null;
  eligibleContractDate: string | null;
  propertyCount: number;
  categories: string[];
  flags: string[];
};

const FLAG_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  ESTATE: "good",
  DECEASED: "good",
  BUSINESS: "bad",
  UNKNOWN: "bad",
  NO_ADDRESS: "warn",
  DELIVERY_DATE_MISSING: "warn",
};

export function ScreeningTable({ rows, canAct }: { rows: Row[]; canAct: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState<BulkState, FormData>(async (prev, fd) => {
    const result = await bulkScreen(prev, fd);
    setSelected(new Set()); // moved cases leave the queue
    return result;
  }, {});
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <form action={action}>
      <Card>
        {state.ok ? (
          <div className="mb-3">
            <Alert tone="info">{state.ok}</Alert>
          </div>
        ) : null}
        {state.error ? (
          <div className="mb-3">
            <Alert>{state.error}</Alert>
          </div>
        ) : null}
        {state.failures?.length ? (
          <div className="mb-3">
            <Alert tone="warning">
              <ul className="list-disc pl-4">
                {state.failures.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </Alert>
          </div>
        ) : null}
        {canAct ? (
          <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1"
              onClick={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))}
            >
              {selected.size === rows.length && rows.length > 0 ? "Clear selection" : "Select all on page"}
            </button>
            <Button type="submit" name="decision" value="SCREEN" disabled={pending || selected.size === 0}>
              Screen in {selected.size > 0 ? `(${selected.size})` : ""}
            </Button>
            <label className="flex items-end gap-2">
              <span>
                <span className="block font-medium">Reason (for closing)</span>
                <input name="reason" className="mt-1 w-64 rounded-md border border-slate-300 px-2 py-1" placeholder="e.g. business owner, amount too small" />
              </span>
            </label>
            <Button type="submit" name="decision" value="INELIGIBLE" variant="secondary" disabled={pending || selected.size === 0}>
              Close as ineligible
            </Button>
          </div>
        ) : null}
        <ScrollRegion label="Cases to screen">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                {canAct ? <th scope="col" className="w-8 py-1"><span className="sr-only">Select</span></th> : null}
                <th scope="col" className="py-1 pr-3 font-medium">Score</th>
                <th scope="col" className="py-1 pr-3 font-medium">Case</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Reported</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Expected value</th>
                <th scope="col" className="py-1 pr-3 font-medium">Eligible from</th>
                <th scope="col" className="py-1 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-3 text-slate-600">
                    No cases waiting for screening.
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  {canAct ? (
                    <td className="py-2">
                      <input
                        type="checkbox"
                        name="caseId"
                        value={r.id}
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select ${caseRef(r.caseNumber)}`}
                      />
                    </td>
                  ) : null}
                  <td className="py-2 pr-3">
                    <Badge tone={scoreTone(r.score)}>{r.score ?? "—"}</Badge>
                  </td>
                  <td className="py-2 pr-3">
                    <Link href={`/cases/${r.id}`} className="font-medium underline">
                      {r.owner}
                    </Link>
                    <span className="block font-mono text-xs text-slate-500">
                      {caseRef(r.caseNumber)} · {r.propertyCount} propert{r.propertyCount === 1 ? "y" : "ies"}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {r.flags.filter((f) => FLAG_TONE[f]).map((f) => (
                        <Badge key={f} tone={FLAG_TONE[f]}>
                          {f.toLowerCase().replaceAll("_", " ")}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatUsd(r.estimatedValueCents)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatUsd(r.expectedValueCents)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.eligibleContractDate ?? "unknown"}</td>
                  <td className="py-2 text-xs text-slate-700">{r.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </Card>
    </form>
  );
}
