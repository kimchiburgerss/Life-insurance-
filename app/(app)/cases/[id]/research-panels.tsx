"use client";

import { useActionState } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import type { DeathMatch } from "@/lib/research/death";
import type { ObituaryExtraction } from "@/lib/research/obituary";
import {
  acceptExtractionAction,
  acceptSummaryAction,
  acceptTracingAction,
  addEvidenceAction,
  estimateTracingAction,
  extractAction,
  lookupContactAction,
  mergePersonsAction,
  rejectSuggestionAction,
  saveContactAction,
  savePersonAction,
  searchSourcesAction,
  summarizeAction,
  type ActionState,
  type LookupState,
  type SearchState,
} from "./research-actions";

const input = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.ok) return <Alert tone="info">{state.ok}</Alert>;
  return null;
}

// ─── Sources / evidence ─────────────────────────────────────────────────────

export type EvidenceRow = {
  id: string;
  sourceType: string;
  title: string | null;
  url: string | null;
  supportsDeath: boolean;
  hasText: boolean;
  extracted: boolean;
  pendingExtraction: boolean;
  addedAt: string;
};

function ExtractButton({ caseId, evidenceId }: { caseId: string; evidenceId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(extractAction, {});
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Extracting…" : "Extract facts with AI"}
      </Button>
      {state.error ? <Alert>{state.error}</Alert> : null}
    </form>
  );
}

export function EvidencePanel({ caseId, canWrite, evidence }: { caseId: string; canWrite: boolean; evidence: EvidenceRow[] }) {
  const [addState, addAction, adding] = useActionState<ActionState, FormData>(addEvidenceAction, {});
  const [searchState, searchAction, searching] = useActionState<SearchState, FormData>(searchSourcesAction, {});
  return (
    <div className="space-y-4">
      {evidence.length === 0 ? (
        <p className="text-sm text-slate-600">No sources yet. A cited source confirming the death is required before the owner can be marked deceased.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {evidence.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div>
                <span className="font-medium">{e.title ?? "Untitled source"}</span>{" "}
                <Badge>{e.sourceType.toLowerCase().replaceAll("_", " ")}</Badge>{" "}
                {e.supportsDeath ? <Badge tone="good">confirms death</Badge> : null}{" "}
                {e.extracted ? <Badge tone="good">facts accepted</Badge> : null}
                {e.pendingExtraction ? <Badge tone="warn">AI suggestion waiting for review</Badge> : null}
                <span className="block text-xs text-slate-500">
                  added {e.addedAt}
                  {e.url ? (
                    <>
                      {" · "}
                      <a className="underline" href={e.url} target="_blank" rel="noreferrer noopener">
                        open source
                      </a>
                    </>
                  ) : null}
                </span>
              </div>
              {canWrite && e.hasText && !e.extracted && !e.pendingExtraction ? <ExtractButton caseId={caseId} evidenceId={e.id} /> : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <>
          <form action={searchAction} className="space-y-2">
            <input type="hidden" name="caseId" value={caseId} />
            <Button type="submit" variant="secondary" disabled={searching}>
              {searching ? "Searching…" : "Search configured death-record sources"}
            </Button>
            <Result state={searchState} />
          </form>
          {searchState.results?.map((r, i) => (
            <form key={i} action={addAction} className="rounded-md border border-slate-200 p-3 text-sm">
              <input type="hidden" name="caseId" value={caseId} />
              <input type="hidden" name="sourceType" value={r.sourceType} />
              <input type="hidden" name="title" value={r.title} />
              <input type="hidden" name="url" value={r.url ?? ""} />
              <input type="hidden" name="rawText" value={r.text} />
              <p className="font-medium">{r.title}</p>
              <p className="text-xs text-slate-500">{r.sourceName}</p>
              <p className="mt-1 text-slate-700">{r.text}</p>
              <Button type="submit" variant="secondary" className="mt-2" disabled={adding}>
                Add as a source
              </Button>
            </form>
          ))}

          <details className="rounded-md border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-medium">Add a source by hand (link, obituary text, record)</summary>
            <form action={addAction} className="mt-3 space-y-3 text-sm">
              <input type="hidden" name="caseId" value={caseId} />
              <label className="block">
                <span className="font-medium">Source type</span>
                <select name="sourceType" className={input} defaultValue="OBITUARY">
                  <option value="OBITUARY">Obituary / death notice</option>
                  <option value="DEATH_RECORD_INDEX">Death record index</option>
                  <option value="PROBATE_FILING">Probate filing</option>
                  <option value="PUBLIC_RECORD">Other public record</option>
                  <option value="USER_UPLOADED_DOCUMENT">Document from the family</option>
                  <option value="MANUAL_NOTE">Research note</option>
                </select>
              </label>
              <label className="block">
                <span className="font-medium">Title</span>
                <input name="title" required className={input} placeholder="e.g. Las Vegas Review-Journal obituary, Mar 2021" />
              </label>
              <label className="block">
                <span className="font-medium">Link (optional)</span>
                <input name="url" type="url" className={input} placeholder="https://…" />
              </label>
              <label className="block">
                <span className="font-medium">Text (paste the obituary to let AI extract the facts)</span>
                <textarea name="rawText" rows={5} className={input} />
                <span className="text-xs text-slate-600">Don&apos;t paste Social Security numbers; any SSN-like number is removed before saving.</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="supportsDeath" className="mt-1" />
                <span>This source itself confirms the owner&apos;s death (e.g. a death-index record or death certificate).</span>
              </label>
              <Button type="submit" disabled={adding}>
                {adding ? "Adding…" : "Add source"}
              </Button>
            </form>
          </details>
          <Result state={addState} />
        </>
      ) : null}
    </div>
  );
}

// ─── AI extraction review ───────────────────────────────────────────────────

const HEIR_RELATIONSHIPS = new Set(["SPOUSE", "CHILD", "GRANDCHILD", "GREAT_GRANDCHILD", "PARENT", "SIBLING", "NIECE_NEPHEW", "GRANDPARENT", "AUNT_UNCLE", "COUSIN"]);

export function ExtractionReview(props: {
  caseId: string;
  runId: string;
  evidenceTitle: string;
  model: string;
  output: ObituaryExtraction;
  match: DeathMatch;
  quoteFound: boolean[];
  canWrite: boolean;
}) {
  const [acceptState, acceptAction, accepting] = useActionState<ActionState, FormData>(acceptExtractionAction, {});
  const [rejectState, rejectAction, rejecting] = useActionState<ActionState, FormData>(rejectSuggestionAction, {});
  const d = props.output.deceased;
  const tone = props.match.verdict === "STRONG" ? "good" : props.match.verdict === "POSSIBLE" ? "warn" : "bad";
  return (
    <div className="space-y-3 rounded-md border-2 border-amber-300 bg-amber-50/40 p-4 text-sm">
      <p className="font-semibold">
        AI suggestion from “{props.evidenceTitle}” <span className="font-normal text-slate-600">({props.model}) — review before accepting</span>
      </p>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
        <dt className="text-slate-600">Deceased</dt>
        <dd>
          {d.fullName || "—"} {d.otherNames.length ? `(also ${d.otherNames.join(", ")})` : ""} {d.age !== null ? `· age ${d.age}` : ""}
        </dd>
        <dt className="text-slate-600">Date of death</dt>
        <dd>{d.dateOfDeath ?? "not stated"}</dd>
        <dt className="text-slate-600">Lived in</dt>
        <dd>{[d.residenceCity, d.residenceState].filter(Boolean).join(", ") || "not stated"}</dd>
      </dl>
      <div>
        <p className="font-medium">
          Is this our owner? <Badge tone={tone}>{props.match.verdict.toLowerCase()} · {Math.round(props.match.confidence * 100)}%</Badge>
        </p>
        <ul className="mt-1 list-disc pl-5">
          {props.match.factors.map((f, i) => (
            <li key={i}>
              <span className={f.effect === "+" ? "text-emerald-800" : f.effect === "−" ? "text-red-800" : ""}>{f.effect}</span> {f.label}
            </li>
          ))}
        </ul>
      </div>
      <form action={acceptAction} className="space-y-3">
        <input type="hidden" name="caseId" value={props.caseId} />
        <input type="hidden" name="aiRunId" value={props.runId} />
        <fieldset>
          <legend className="font-medium">Relatives named ({props.output.relatives.length}) — tick the ones to add as heir candidates</legend>
          {props.output.relatives.length === 0 ? <p className="text-slate-600">None found.</p> : null}
          <ul className="mt-1 space-y-1">
            {props.output.relatives.map((r, i) => (
              <li key={i}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" name="relative" value={i} defaultChecked={HEIR_RELATIONSHIPS.has(r.relationship)} disabled={!props.canWrite} className="mt-1" />
                  <span>
                    <strong>{r.name}</strong> — {r.relationship.toLowerCase().replaceAll("_", " ")}, {r.status.toLowerCase()}
                    {r.throughRelativeName ? `, through ${r.throughRelativeName}` : ""}
                    <span className="block text-xs text-slate-600">
                      “{r.evidenceQuote}” {props.quoteFound[i] ? "" : <strong className="text-red-800">— not found verbatim in the text; check it</strong>}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {props.output.notes ? <p className="text-slate-700">Note: {props.output.notes}</p> : null}
        {props.canWrite ? (
          <>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="confirmsOwnerDeath" className="mt-1" defaultChecked={props.match.verdict === "STRONG"} />
              <span>I checked it: this obituary is about our owner, so it confirms the owner&apos;s death.</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={accepting}>
                {accepting ? "Saving…" : "Accept"}
              </Button>
            </div>
          </>
        ) : null}
        <Result state={acceptState} />
      </form>
      {props.canWrite ? (
        <form action={rejectAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="caseId" value={props.caseId} />
          <input type="hidden" name="aiRunId" value={props.runId} />
          <label className="flex-1">
            <span className="text-slate-700">Reason (optional)</span>
            <input name="note" className={input} placeholder="e.g. different person with the same name" />
          </label>
          <Button type="submit" variant="secondary" disabled={rejecting}>
            Reject suggestion
          </Button>
          <Result state={rejectState} />
        </form>
      ) : null}
    </div>
  );
}

// ─── People / heirs ─────────────────────────────────────────────────────────

export type PersonRow = {
  id: string;
  fullName: string;
  relationship: string;
  status: string;
  isPredeceased: boolean;
  confidence: number;
  parentPersonId: string | null;
  sources: number;
  notes: string | null;
  hasAddress: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
};

const RELATIONSHIPS = ["NAMED_BENEFICIARY", "SPOUSE", "CHILD", "GRANDCHILD", "PARENT", "SIBLING", "NIECE_NEPHEW", "GRANDPARENT", "AUNT_UNCLE", "COUSIN", "OTHER", "UNKNOWN"];

function PersonForm({ caseId, person, people }: { caseId: string; person: PersonRow | null; people: PersonRow[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePersonAction, {});
  return (
    <form action={action} className="grid gap-2 text-sm sm:grid-cols-2">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="personId" value={person?.id ?? ""} />
      <label>
        <span className="font-medium">Full name</span>
        <input name="fullName" defaultValue={person?.fullName} required className={input} />
      </label>
      <label>
        <span className="font-medium">Relationship to the owner</span>
        <select name="relationship" defaultValue={person?.relationship ?? "CHILD"} className={input}>
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {r.toLowerCase().replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="font-medium">Descends from (for grandchildren, nieces, nephews)</span>
        <select name="parentPersonId" defaultValue={person?.parentPersonId ?? ""} className={input}>
          <option value="">—</option>
          {people
            .filter((p) => p.id !== person?.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} ({p.relationship.toLowerCase()})
              </option>
            ))}
        </select>
      </label>
      <label>
        <span className="font-medium">Status</span>
        <select name="status" defaultValue={person?.status ?? "CANDIDATE"} className={input}>
          <option value="CANDIDATE">Candidate</option>
          <option value="CONFIRMED">Confirmed (two independent sources)</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      <label>
        <span className="font-medium">Confidence in the relationship (0–1)</span>
        <input name="confidence" type="number" min={0} max={1} step={0.05} defaultValue={person?.confidence ?? 0.5} className={input} />
      </label>
      <label className="flex items-center gap-2 pt-5">
        <input type="checkbox" name="isPredeceased" defaultChecked={person?.isPredeceased} /> Died before the owner
      </label>
      <label className="sm:col-span-2">
        <span className="font-medium">Notes</span>
        <textarea name="notes" rows={2} defaultValue={person?.notes ?? ""} className={input} />
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {person ? "Save changes" : "Add person"}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <Result state={state} />
      </div>
    </form>
  );
}

function ContactPanel({ caseId, person }: { caseId: string; person: PersonRow }) {
  const [lookup, lookupAction, looking] = useActionState<LookupState, FormData>(lookupContactAction, {});
  const [save, saveAction, saving] = useActionState<ActionState, FormData>(saveContactAction, {});
  return (
    <div className="space-y-3 text-sm">
      <form action={lookupAction} className="space-y-2">
        <input type="hidden" name="personId" value={person.id} />
        <label className="flex items-start gap-2">
          <input type="checkbox" name="purpose" className="mt-1" />
          <span>I&apos;m using this lookup only to locate this person as a possible heir for this case (permissible purpose under our data-vendor agreement).</span>
        </label>
        <Button type="submit" variant="secondary" disabled={looking}>
          {looking ? "Looking up…" : "Find contact details"}
        </Button>
        <Result state={lookup} />
      </form>
      {lookup.matches?.map((m) => (
        <form key={m.vendorRecordId} action={saveAction} className="rounded-md border border-slate-200 p-2">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="personId" value={person.id} />
          <input type="hidden" name="source" value="VENDOR" />
          <input type="hidden" name="sourceDetail" value={lookup.provider ?? "vendor"} />
          <input type="hidden" name="vendorRecordId" value={m.vendorRecordId} />
          <input type="hidden" name="address" value={m.address ?? ""} />
          <input type="hidden" name="phone" value={m.phone ?? ""} />
          <input type="hidden" name="email" value={m.email ?? ""} />
          <p>
            <strong>{m.fullName}</strong> · age {m.ageRange ?? "?"} · match {m.confidence !== null ? `${Math.round(m.confidence * 100)}%` : "n/a"}
          </p>
          <p className="text-slate-700">{[m.address, m.phone, m.email].filter(Boolean).join(" · ") || "no contact details"}</p>
          {m.relativesOnFile.length ? <p className="text-xs text-slate-600">Relatives on file: {m.relativesOnFile.join(", ")}</p> : null}
          <Button type="submit" variant="secondary" className="mt-1" disabled={saving}>
            Save these details
          </Button>
        </form>
      ))}
      <details>
        <summary className="cursor-pointer">Enter contact details by hand</summary>
        <form action={saveAction} className="mt-2 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="personId" value={person.id} />
          <input type="hidden" name="source" value="MANUAL" />
          <label className="sm:col-span-2">
            Mailing address
            <input name="address" className={input} />
          </label>
          <label>
            Phone
            <input name="phone" className={input} />
          </label>
          <label>
            Email
            <input name="email" type="email" className={input} />
          </label>
          <label className="sm:col-span-2">
            Where did this come from?
            <input name="sourceDetail" required className={input} placeholder="e.g. the person called us; county property record" />
          </label>
          <div>
            <Button type="submit" variant="secondary" disabled={saving}>
              Save
            </Button>
          </div>
        </form>
      </details>
      <Result state={save} />
    </div>
  );
}

export function PeoplePanel(props: {
  caseId: string;
  canWrite: boolean;
  people: PersonRow[];
  duplicates: { a: { id: string; fullName: string }; b: { id: string; fullName: string }; score: number }[];
}) {
  const [mergeState, mergeAction, merging] = useActionState<ActionState, FormData>(mergePersonsAction, {});
  return (
    <div className="space-y-3">
      {props.duplicates.length ? (
        <Alert tone="warning">
          <p className="font-medium">Possible duplicates (never merged automatically):</p>
          <ul className="mt-1 space-y-1">
            {props.duplicates.map((d) => (
              <li key={`${d.a.id}-${d.b.id}`}>
                <form action={mergeAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="caseId" value={props.caseId} />
                  <input type="hidden" name="keepId" value={d.a.id} />
                  <input type="hidden" name="removeId" value={d.b.id} />
                  {d.a.fullName} ↔ {d.b.fullName} ({Math.round(d.score * 100)}% similar)
                  {props.canWrite ? (
                    <Button type="submit" variant="secondary" disabled={merging}>
                      Same person — keep “{d.a.fullName}”
                    </Button>
                  ) : null}
                </form>
              </li>
            ))}
          </ul>
          <Result state={mergeState} />
        </Alert>
      ) : null}
      <ul className="space-y-2">
        {props.people.map((p) => (
          <li key={p.id} className="rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <strong>{p.fullName}</strong>
              <Badge>{p.relationship.toLowerCase().replaceAll("_", " ")}</Badge>
              <Badge tone={p.status === "CONFIRMED" ? "good" : p.status === "REJECTED" ? "bad" : "warn"}>{p.status.toLowerCase()}</Badge>
              {p.isPredeceased ? <Badge>predeceased</Badge> : null}
              <span className="text-slate-600">
                confidence {Math.round(p.confidence * 100)}% · {p.sources} source{p.sources === 1 ? "" : "s"} · contact:{" "}
                {[p.hasAddress && "address", p.hasPhone && "phone", p.hasEmail && "email"].filter(Boolean).join(", ") || "none yet"}
              </span>
            </div>
            {p.notes ? <p className="mt-1 text-xs text-slate-600">{p.notes}</p> : null}
            {props.canWrite ? (
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <details>
                  <summary className="cursor-pointer text-sm underline">Edit</summary>
                  <div className="mt-2">
                    <PersonForm caseId={props.caseId} person={p} people={props.people} />
                  </div>
                </details>
                {!p.isPredeceased && p.status !== "REJECTED" ? (
                  <details>
                    <summary className="cursor-pointer text-sm underline">Contact details</summary>
                    <div className="mt-2">
                      <ContactPanel caseId={props.caseId} person={p} />
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {props.canWrite ? (
        <details className="rounded-md border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium">Add a person by hand</summary>
          <div className="mt-2">
            <PersonForm caseId={props.caseId} person={null} people={props.people} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

// ─── Research summary & tracing ─────────────────────────────────────────────

export type SummaryView = {
  runId: string;
  createdAt: string;
  model: string;
  acceptance: string;
  output: { known: string[]; uncertain: string[]; nextSteps: { step: string; why: string }[]; outreachReadiness: string };
};

export function SummaryPanel({ caseId, canWrite, summary }: { caseId: string; canWrite: boolean; summary: SummaryView | null }) {
  const [genState, genAction, generating] = useActionState<ActionState, FormData>(summarizeAction, {});
  const [accState, accAction, accepting] = useActionState<ActionState, FormData>(acceptSummaryAction, {});
  return (
    <div className="space-y-3 text-sm">
      {summary ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">
            Generated {summary.createdAt} by {summary.model} ·{" "}
            <Badge tone={summary.acceptance === "ACCEPTED" ? "good" : summary.acceptance === "REJECTED" ? "bad" : "warn"}>
              {summary.acceptance === "PENDING" ? "suggestion — not yet reviewed" : summary.acceptance.toLowerCase()}
            </Badge>
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <h4 className="font-medium">Known</h4>
              <ul className="list-disc pl-5">{summary.output.known.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </div>
            <div>
              <h4 className="font-medium">Uncertain</h4>
              <ul className="list-disc pl-5">{summary.output.uncertain.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </div>
          </div>
          <div>
            <h4 className="font-medium">Next best steps</h4>
            <ol className="list-decimal pl-5">
              {summary.output.nextSteps.map((s, i) => (
                <li key={i}>
                  {s.step} <span className="text-slate-600">— {s.why}</span>
                </li>
              ))}
            </ol>
          </div>
          <p>
            <span className="font-medium">Outreach readiness:</span> {summary.output.outreachReadiness}
          </p>
          {canWrite && summary.acceptance === "PENDING" ? (
            <form action={accAction}>
              <input type="hidden" name="caseId" value={caseId} />
              <input type="hidden" name="aiRunId" value={summary.runId} />
              <Button type="submit" variant="secondary" disabled={accepting}>
                Mark as reviewed and accurate
              </Button>
              <Result state={accState} />
            </form>
          ) : null}
        </div>
      ) : (
        <p className="text-slate-600">No summary yet.</p>
      )}
      {canWrite ? (
        <form action={genAction}>
          <input type="hidden" name="caseId" value={caseId} />
          <Button type="submit" variant="secondary" disabled={generating}>
            {generating ? "Summarizing…" : summary ? "Regenerate summary" : "Generate research summary"}
          </Button>
          <Result state={genState} />
        </form>
      ) : null}
    </div>
  );
}

export function TracingPanel(props: {
  caseId: string;
  canWrite: boolean;
  pending: { runId: string; difficulty: number; rationale: string } | null;
  accepted: { difficulty: number; rationale: string } | null;
}) {
  const [estState, estAction, estimating] = useActionState<ActionState, FormData>(estimateTracingAction, {});
  const [accState, accAction, accepting] = useActionState<ActionState, FormData>(acceptTracingAction, {});
  const [rejState, rejAction] = useActionState<ActionState, FormData>(rejectSuggestionAction, {});
  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
      {props.accepted ? (
        <p>
          AI tracing estimate (accepted): <strong>{props.accepted.difficulty}/5</strong> — {props.accepted.rationale}
        </p>
      ) : null}
      {props.pending ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/40 p-2">
          <p>
            Suggested tracing difficulty <strong>{props.pending.difficulty}/5</strong>: {props.pending.rationale}
          </p>
          {props.canWrite ? (
            <div className="mt-2 flex gap-2">
              <form action={accAction}>
                <input type="hidden" name="caseId" value={props.caseId} />
                <input type="hidden" name="aiRunId" value={props.pending.runId} />
                <Button type="submit" variant="secondary" disabled={accepting}>
                  Accept (updates the score)
                </Button>
              </form>
              <form action={rejAction}>
                <input type="hidden" name="caseId" value={props.caseId} />
                <input type="hidden" name="aiRunId" value={props.pending.runId} />
                <Button type="submit" variant="secondary">
                  Reject
                </Button>
              </form>
            </div>
          ) : null}
          <Result state={accState} />
          <Result state={rejState} />
        </div>
      ) : props.canWrite ? (
        <form action={estAction}>
          <input type="hidden" name="caseId" value={props.caseId} />
          <Button type="submit" variant="secondary" disabled={estimating}>
            {estimating ? "Estimating…" : "Ask AI for a tracing-difficulty estimate"}
          </Button>
          <Result state={estState} />
        </form>
      ) : null}
    </div>
  );
}
