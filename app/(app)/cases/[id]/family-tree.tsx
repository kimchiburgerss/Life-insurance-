import { Badge } from "@/components/ui";
import { fmt, type IntestateResult } from "@/lib/research/intestate";

export type TreePerson = {
  id: string;
  fullName: string;
  relationship: string;
  status: string;
  isPredeceased: boolean;
  parentPersonId: string | null;
};

function Node({ p, people }: { p: TreePerson; people: TreePerson[] }) {
  const kids = people.filter((c) => c.parentPersonId === p.id);
  return (
    <li className="mt-1">
      <span className={`inline-flex flex-wrap items-center gap-1 rounded border px-2 py-0.5 ${p.status === "REJECTED" ? "border-slate-200 text-slate-400 line-through" : "border-slate-300 bg-white"}`}>
        {p.isPredeceased ? <span aria-label="predeceased" title="died before the owner">†</span> : null}
        {p.fullName}
        {p.status === "CONFIRMED" ? <Badge tone="good">confirmed</Badge> : p.status === "CANDIDATE" ? <Badge tone="warn">candidate</Badge> : null}
      </span>
      {kids.length ? (
        <ul className="ml-5 border-l border-slate-300 pl-3">
          {kids.map((k) => (
            <Node key={k.id} p={k} people={people} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Group({ title, members, people }: { title: string; members: TreePerson[]; people: TreePerson[] }) {
  if (members.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <ul>
        {members.map((m) => (
          <Node key={m.id} p={m} people={people} />
        ))}
      </ul>
    </div>
  );
}

export function FamilyTree({ ownerName, people, intestate }: { ownerName: string; people: TreePerson[]; intestate: IntestateResult | null }) {
  const top = (rel: string[]) => people.filter((p) => rel.includes(p.relationship) && !(p.parentPersonId && people.some((x) => x.id === p.parentPersonId)));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3 text-sm" aria-label="Family tree">
        <div className="rounded-md border-2 border-slate-800 bg-slate-50 px-3 py-2 font-semibold">
          † {ownerName} <span className="font-normal text-slate-600">(owner, deceased)</span>
        </div>
        {people.length === 0 ? <p className="text-slate-600">No relatives recorded yet. Accept an obituary extraction or add people by hand.</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Group title="Named beneficiary" members={top(["NAMED_BENEFICIARY"])} people={people} />
          <Group title="Spouse" members={top(["SPOUSE"])} people={people} />
          <Group title="Parents" members={top(["PARENT"])} people={people} />
          <Group title="Children → grandchildren" members={top(["CHILD", "GRANDCHILD"])} people={people} />
          <Group title="Siblings → nieces & nephews" members={top(["SIBLING", "NIECE_NEPHEW"])} people={people} />
          <Group title="Grandparents, aunts, uncles, cousins" members={top(["GRANDPARENT", "AUNT_UNCLE", "COUSIN"])} people={people} />
          <Group title="Other / unknown" members={top(["OTHER", "UNKNOWN"])} people={people} />
        </div>
        <p className="text-xs text-slate-600">† died before the owner. Link grandchildren, nieces and nephews to their parent (Edit → “Descends from”).</p>
      </div>

      <div className="text-sm">
        <h4 className="font-semibold">
          Who likely has a claim <Badge tone="warn">research aid, not legal advice</Badge>
        </h4>
        {!intestate ? (
          <p className="mt-2 text-slate-600">No inheritance rule is configured for this state.</p>
        ) : (
          <>
            {intestate.heirs.length ? (
              <table className="mt-2 w-full">
                <caption className="sr-only">Suggested shares</caption>
                <thead className="text-left text-slate-600">
                  <tr>
                    <th scope="col" className="py-1 font-medium">Person</th>
                    <th scope="col" className="py-1 font-medium">Share</th>
                    <th scope="col" className="py-1 font-medium">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {intestate.heirs.map((h) => (
                    <tr key={h.personId} className="border-t border-slate-100">
                      <td className="py-1">{h.name}</td>
                      <td className="py-1 font-mono">{fmt(h.share)}</td>
                      <td className="py-1 text-slate-700">{h.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-slate-600">Not enough family information to suggest shares yet.</p>
            )}
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
              {intestate.notes.map((n, i) => (
                <li key={`n${i}`}>{n}</li>
              ))}
              {intestate.needsResearch.map((n, i) => (
                <li key={`r${i}`} className="text-amber-900">
                  {n}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
