import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import type { PropertyCategory } from "@/lib/generated/prisma/enums";
import { ScreeningTable } from "./screening-table";

export const metadata: Metadata = { title: "Screening queue" };

const PAGE = 50;
const CATEGORIES: PropertyCategory[] = ["LIFE_INSURANCE", "ANNUITY", "ESTATE", "OTHER", "UNKNOWN"];

export default async function ScreeningPage({ searchParams }: PageProps<"/screening">) {
  const operator = await requireOperator("case:read");
  const sp = await searchParams;
  const minScore = Math.max(0, Math.min(100, Number(sp.minScore ?? 0) || 0));
  const category = CATEGORIES.find((c) => c === sp.category);
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const where = {
    stage: "IMPORTED" as const,
    priorityScore: { gte: minScore },
    ...(category ? { properties: { some: { category } } } : {}),
  };
  const [cases, total] = await Promise.all([
    prisma.case.findMany({
      where,
      orderBy: [{ priorityScore: { sort: "desc", nulls: "last" } }, { caseNumber: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      select: {
        id: true,
        caseNumber: true,
        priorityScore: true,
        priorityExplanation: true,
        expectedValueCents: true,
        estimatedValueCents: true,
        eligibleContractDate: true,
        owner: { select: { fullName: true } },
        _count: { select: { properties: true } },
        properties: { select: { category: true, flags: true }, take: 10 },
      },
    }),
    prisma.case.count({ where }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Screening queue</h1>
        <p className="max-w-3xl text-sm text-slate-600">
          Newly imported cases, highest priority first. Screen in the ones worth researching; close the rest with a
          reason. Every move is checked by the same rules as the case page and recorded in the audit log.
        </p>
      </div>
      <Card>
        <form className="flex flex-wrap items-end gap-3 text-sm" method="get">
          <label>
            <span className="block font-medium">Minimum score</span>
            <input type="number" name="minScore" min={0} max={100} defaultValue={minScore} className="mt-1 w-24 rounded-md border border-slate-300 px-2 py-1" />
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
          <button className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50">Filter</button>
          <span className="text-slate-600">{total} cases</span>
        </form>
      </Card>
      <ScreeningTable
        canAct={can(operator.role, "case:transition:research")}
        rows={cases.map((c) => ({
          id: c.id,
          caseNumber: c.caseNumber,
          owner: c.owner.fullName,
          score: c.priorityScore,
          explanation: c.priorityExplanation,
          expectedValueCents: c.expectedValueCents,
          estimatedValueCents: c.estimatedValueCents,
          eligibleContractDate: c.eligibleContractDate?.toISOString().slice(0, 10) ?? null,
          propertyCount: c._count.properties,
          categories: [...new Set(c.properties.map((p) => p.category))],
          flags: [...new Set(c.properties.flatMap((p) => p.flags))],
        }))}
      />
      <nav aria-label="Pages" className="flex gap-3 text-sm">
        {page > 1 ? (
          <a className="underline" href={`?minScore=${minScore}&category=${category ?? ""}&page=${page - 1}`}>
            ← Previous
          </a>
        ) : null}
        {page * PAGE < total ? (
          <a className="underline" href={`?minScore=${minScore}&category=${category ?? ""}&page=${page + 1}`}>
            Next →
          </a>
        ) : null}
      </nav>
    </div>
  );
}
