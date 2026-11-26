"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import { createDraftAction, logInboundAction, type ActionState } from "../../outreach/actions";

export type OutreachHeir = {
  id: string;
  name: string;
  relationship: string;
  hasAddress: boolean;
  hasEmail: boolean;
  doNotContact: boolean;
  drafted: { MAIL: boolean; EMAIL: boolean };
};

export type CommRow = {
  id: string;
  when: string;
  direction: "OUTBOUND" | "INBOUND";
  channel: string;
  step: number | null;
  person: string | null;
  status: string;
  summary: string | null;
};

const TONE: Record<string, "neutral" | "good" | "warn" | "bad"> = {
  PENDING_APPROVAL: "warn",
  APPROVED: "good",
  SENT: "good",
  DELIVERED: "good",
  RECEIVED: "good",
  RETURNED: "bad",
  FAILED: "bad",
  REJECTED: "bad",
};

function DraftButton({ caseId, personId, channel, label }: { caseId: string; personId: string; channel: "MAIL" | "EMAIL"; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createDraftAction, {});
  return (
    <form action={action} className="inline-block">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="channel" value={channel} />
      <Button type="submit" variant="secondary" disabled={pending} className="px-3 py-1">
        {pending ? "Drafting…" : label}
      </Button>
      {state.error ? <span className="mt-1 block max-w-md text-sm text-red-800" role="alert">{state.error}</span> : null}
    </form>
  );
}

function LogReplyForm({ caseId, people }: { caseId: string; people: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(logInboundAction, {});
  const field = "mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="caseId" value={caseId} />
      <label className="text-sm font-medium">
        From
        <select name="personId" className={field} defaultValue={people[0]?.id ?? ""}>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="">Someone else / unknown</option>
        </select>
      </label>
      <label className="text-sm font-medium">
        How
        <select name="channel" className={field} defaultValue="INBOUND_PHONE_NOTE">
          <option value="INBOUND_PHONE_NOTE">They called us</option>
          <option value="EMAIL">Email reply</option>
          <option value="MAIL">Letter</option>
        </select>
      </label>
      <label className="text-sm font-medium sm:col-span-2">
        What they said
        <textarea name="summary" rows={3} required className={field} placeholder="Short summary of the conversation (never record SSNs)" />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="optOut" /> They asked us not to contact them again (adds them to the do-not-contact list)
      </label>
      <div className="sm:col-span-2 space-y-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          Log reply
        </Button>
        {state.error ? <Alert>{state.error}</Alert> : state.ok ? <Alert tone="info">{state.ok}</Alert> : null}
      </div>
    </form>
  );
}

export function OutreachPanel(props: {
  caseId: string;
  canWrite: boolean;
  blockedReason: string | null;
  heirs: OutreachHeir[];
  comms: CommRow[];
  allPeople: { id: string; name: string }[];
}) {
  return (
    <div className="space-y-6">
      {props.blockedReason ? <Alert tone="info">{props.blockedReason}</Alert> : null}
      {!props.blockedReason && props.canWrite ? (
        props.heirs.length === 0 ? (
          <p className="text-sm text-slate-600">No living heir candidate with a confidence of 0.6+ yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {props.heirs.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-48 font-medium">
                  {h.name} <span className="font-normal text-slate-600">({h.relationship.toLowerCase().replaceAll("_", " ")})</span>
                </span>
                {h.doNotContact ? (
                  <Badge tone="bad">do not contact</Badge>
                ) : (
                  <>
                    {h.hasAddress && !h.drafted.MAIL ? <DraftButton caseId={props.caseId} personId={h.id} channel="MAIL" label="Draft letter" /> : null}
                    {h.hasEmail && !h.drafted.EMAIL ? <DraftButton caseId={props.caseId} personId={h.id} channel="EMAIL" label="Draft email" /> : null}
                    {!h.hasAddress && !h.hasEmail ? <span className="text-slate-600">No address or email yet — add contact details above.</span> : null}
                    {h.drafted.MAIL || h.drafted.EMAIL ? <span className="text-slate-600">First contact already drafted or sent.</span> : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Communications</h3>
        {props.comms.length === 0 ? (
          <p className="text-sm text-slate-600">None yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">When</th>
                <th scope="col" className="py-1 pr-3 font-medium">What</th>
                <th scope="col" className="py-1 pr-3 font-medium">Who</th>
                <th scope="col" className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {props.comms.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="py-1 pr-3 whitespace-nowrap">{c.when}</td>
                  <td className="py-1 pr-3">
                    {c.direction === "OUTBOUND" ? (
                      <Link href={`/outreach/${c.id}`} className="underline">
                        {c.channel === "MAIL" ? "Letter" : "Email"} {c.step && c.step > 1 ? `· follow-up ${c.step - 1}` : "· first contact"}
                      </Link>
                    ) : (
                      <span>
                        Reply ({c.channel === "INBOUND_PHONE_NOTE" ? "call" : c.channel.toLowerCase()})
                        {c.summary ? <span className="block text-slate-600">{c.summary}</span> : null}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-3">{c.person ?? "—"}</td>
                  <td className="py-1">
                    <Badge tone={TONE[c.status] ?? "neutral"}>{c.status.toLowerCase().replaceAll("_", " ")}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {props.canWrite && props.comms.some((c) => c.direction === "OUTBOUND" && ["SENT", "DELIVERED", "RETURNED"].includes(c.status)) ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Log a reply or call</h3>
          <LogReplyForm caseId={props.caseId} people={props.allPeople} />
        </div>
      ) : null}
    </div>
  );
}
