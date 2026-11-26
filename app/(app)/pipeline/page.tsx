import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { requireOperator } from "@/lib/auth/session";
import { STAGES, TERMINAL_STAGES, stageLabel } from "@/lib/case/stateMachine";
import { prisma } from "@/lib/db";
import { caseRef, formatUsd, parseCaseRef, scoreTone } from "@/lib/format";
import type { CaseStage, PropertyCategory } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";

export const metadata: Metadata = { title: "Pipeline" };

const PER_COLUMN = 25;
const CATEGORIES: PropertyCategory[] = ["LIFE_INSURANCE", "ANNUITY", "ESTATE", "OTHER", "UNKNOWN"];
const ACTIVE_STAGES = STAGES.filter((s) => !TERMINAL_STAGES.has(s));
const CLOSED_STAGES = STAGES.filter((s) => TERMINAL_STAGES.has(s));

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const operator = await requireOperator("case:read");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const category = CATEGORIES.find((c) => c === sp.category);
  const minScore = Math.max(0, Math.min(100, Number(sp.minScore ?? 0) || 0));
  const mine = sp.mine === "1";
  const showClosed = sp.closed === "1";

  const filters: Prisma.CaseWhereInput[] = [];
  if (q) {
    const ref = parseCaseRef(q);
    filters.push({
      OR: [
        ...(ref ? [{ caseNumber: ref }] : []),
        { owner: { fullName: { contains: q, mode: "insensitive" } } },
        { owner: { aliases: { has: q.toUpperCase() } } },
        { properties: { some: { statePropertyId: { equals: q.toUpperCase() } } } },
      ],
    });
  }
  if (category) filters.push({ properties: { some: { category } } });
  if (minScore > 0) filters.push({ priorityScore: { gte: minScore } });
  if (mine) filters.push({ assignedUserId: operator.id });
  const where: Prisma.CaseWhereInput = filters.length ? { AND: filters } : {};

  const counts = await prisma.case.groupBy({ by: ["stage"], where, _count: { _all: true } });
  const countFor = new Map(counts.map((c) => [c.stage, c._count._all]));
  const columns: { key: string; title: string; stages: CaseStage[] }[] = [
    ...ACTIVE_STAGES.map((s) => ({ key: s, title: stageLabel(s), stages: [s] })),
    ...(showClosed ? [{ key: "CLOSED", title: "Closed", stages: CLOSED_STAGES }] : []),
  ];
  const cards = await Promise.all(
    columns.map((col) =>
      prisma.case.findMany({
        where: { AND: [where, { stage: { in: col.stages } }] },
        orderBy: [{ priorityScore: { sort: "desc", nulls: "last" } }, { caseNumber: "asc" }],
        take: PER_COLUMN,
        select: {
          id: true,
          caseNumber: true,
          stage: true,
          priorityScore: true,
          expectedValueCents: true,
          eligibleContractDate: true,
          owner: { select: { fullName: true } },
        },
      }),
    ),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <p className="text-sm text-slate-600">Highest priority first in each stage. Open a case to move it — every move is rule-checked.</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm" role="search">
        <label>
          <span className="block font-medium">Search</span>
          <input name="q" defaultValue={q} placeholder="Owner, NV-000123 or property ID" className="mt-1 w-64 rounded-md border border-slate-300 px-2 py-1" />
        </label>
        <label>
          <span className="block font-medium">Property type</span>
          <select name="category" defaultValue={category ?? ""} className="mt-1 rounded-md border border-slate-300 px-2 py-1">
            <option value="">Any</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.toLowerCase().replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block font-medium">Min score</span>
          <input type="number" name="minScore" min={0} max={100} defaultValue={minScore || ""} className="mt-1 w-20 rounded-md border border-slate-300 px-2 py-1" />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} /> Assigned to me
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="closed" value="1" defaultChecked={showClosed} /> Show closed
        </label>
        <button className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50">Apply</button>
        {q || category || minScore || mine || showClosed ? (
          <Link href="/pipeline" className="underline">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="flex gap-3 overflow-x-auto pb-4" aria-label="Pipeline board">
        {columns.map((col, i) => {
          const total = col.stages.reduce((n, s) => n + (countFor.get(s) ?? 0), 0);
          return (
            <section key={col.key} className="w-64 shrink-0 rounded-lg bg-slate-100 p-2" aria-label={`${col.title}: ${total} cases`}>
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                {col.title} <span className="rounded-full bg-white px-2 text-xs tabular-nums">{total}</span>
              </h2>
              <ul className="space-y-2">
                {cards[i]!.map((c) => (
                  <li key={c.id}>
                    <Link href={`/cases/${c.id}`} className="block rounded-md border border-slate-200 bg-white p-2 text-sm shadow-sm hover:border-slate-400">
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-medium">{c.owner.fullName}</span>
                        <Badge tone={scoreTone(c.priorityScore)}>{c.priorityScore ?? "—"}</Badge>
                      </span>
                      <span className="block font-mono text-xs text-slate-500">{caseRef(c.caseNumber)}</span>
                      <span className="mt-1 block text-xs text-slate-700">
                        EV {formatUsd(c.expectedValueCents)}
                        {c.stage === "WAITING_PERIOD" && c.eligibleContractDate ? ` · unlocks ${c.eligibleContractDate.toISOString().slice(0, 10)}` : ""}
                        {col.key === "CLOSED" ? ` · ${stageLabel(c.stage).replace("Closed ", "")}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
                {total > PER_COLUMN ? <li className="px-1 text-xs text-slate-600">+ {total - PER_COLUMN} more (refine the filters)</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
