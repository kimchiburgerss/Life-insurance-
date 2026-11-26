import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { caseRef, formatUsd } from "@/lib/format";
import { DecisionButtons } from "./decision-buttons";

export const metadata: Metadata = { title: "Review queue" };

type Addr = { formatted?: string | null; line1?: string | null; city?: string | null; postalCode?: string | null };

function addresses(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return [...new Set((json as Addr[]).map((a) => a.formatted ?? [a.line1, a.city, a.postalCode].filter(Boolean).join(", ")).filter(Boolean))];
}

const ownerInclude = {
  select: {
    id: true,
    fullName: true,
    aliases: true,
    lastKnownAddresses: true,
    cases: { select: { id: true, caseNumber: true, stage: true } },
    properties: {
      select: { statePropertyId: true, ownerNameRaw: true, holderName: true, reportedAmountCents: true, category: true },
      take: 5,
    },
  },
} as const;

export default async function ReviewPage() {
  const operator = await requireOperator("case:read");
  const canDecide = can(operator.role, "owners:merge");
  const [pending, total] = await Promise.all([
    prisma.ownerMatchCandidate.findMany({
      where: { status: "PENDING" },
      orderBy: { score: "desc" },
      take: 25,
      include: { newOwner: ownerInclude, existingOwner: ownerInclude, importBatch: { select: { fileName: true } } },
    }),
    prisma.ownerMatchCandidate.count({ where: { status: "PENDING" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="max-w-3xl text-sm text-slate-600">
          Records that might be the same person but weren&apos;t certain enough to group automatically. Merging moves
          the new record&apos;s properties into the existing owner&apos;s case. {total} waiting
          {total > pending.length ? `; showing the ${pending.length} strongest matches` : ""}.
        </p>
      </div>
      {pending.length === 0 ? (
        <Card>
          <p className="text-sm">Nothing to review.</p>
        </Card>
      ) : null}
      {pending.map((c) => (
        <Card
          key={c.id}
          title={
            <span className="flex flex-wrap items-center gap-2">
              Possible match <Badge tone={c.score >= 0.9 ? "good" : "warn"}>{Math.round(c.score * 100)}% similar</Badge>
              {c.importBatch ? <span className="text-sm font-normal text-slate-600">from {c.importBatch.fileName}</span> : null}
            </span>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { label: "New record", o: c.newOwner },
              { label: "Existing owner", o: c.existingOwner },
            ].map(({ label, o }) => (
              <div key={label} className="rounded-md border border-slate-200 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h3>
                <p className="text-lg font-semibold">{o.fullName}</p>
                <dl className="mt-1 space-y-1 text-sm">
                  <div>
                    <dt className="inline text-slate-600">As reported: </dt>
                    <dd className="inline">{o.aliases.join("; ")}</dd>
                  </div>
                  <div>
                    <dt className="inline text-slate-600">Addresses: </dt>
                    <dd className="inline">{addresses(o.lastKnownAddresses).join("; ") || "none"}</dd>
                  </div>
                  <div>
                    <dt className="inline text-slate-600">Cases: </dt>
                    <dd className="inline">
                      {o.cases.map((cs) => (
                        <Link key={cs.id} href={`/cases/${cs.id}`} className="mr-2 underline">
                          {caseRef(cs.caseNumber)} ({cs.stage.toLowerCase().replaceAll("_", " ")})
                        </Link>
                      ))}
                    </dd>
                  </div>
                </dl>
                <ul className="mt-2 text-xs text-slate-700">
                  {o.properties.map((p) => (
                    <li key={p.statePropertyId}>
                      <span className="font-mono">{p.statePropertyId}</span> · {p.holderName ?? "unknown holder"} ·{" "}
                      {formatUsd(p.reportedAmountCents)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm">
            <span className="text-slate-600">Why: </span>
            {(c.reasons as string[]).join(" · ")}
          </p>
          {canDecide ? (
            <div className="mt-3">
              <DecisionButtons candidateId={c.id} />
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
