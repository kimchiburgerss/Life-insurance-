import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, Card } from "@/components/ui";
import { requireOperator } from "@/lib/auth/session";
import { STAGES, stageLabel } from "@/lib/case/stateMachine";
import { prisma } from "@/lib/db";
import { formatDateOnly, todayIn } from "@/lib/dates";

export const metadata: Metadata = { title: "Today" };

function caseRef(n: number) {
  return `NV-${String(n).padStart(6, "0")}`;
}

export default async function TodayPage() {
  await requireOperator("case:read");
  const today = todayIn();

  const [stageCounts, unverifiedRules, upcomingUnlocks, readyCount, totalProperties] = await Promise.all([
    prisma.case.groupBy({ by: ["stage"], _count: { _all: true } }),
    prisma.jurisdictionRule.count({ where: { enabled: true, lastVerifiedAt: null } }),
    prisma.case.findMany({
      where: { stage: "WAITING_PERIOD" },
      orderBy: { eligibleContractDate: "asc" },
      take: 10,
      select: {
        id: true,
        caseNumber: true,
        eligibleContractDate: true,
        estimatedValueCents: true,
        owner: { select: { fullName: true } },
      },
    }),
    prisma.case.count({ where: { stage: "READY_FOR_OUTREACH" } }),
    prisma.property.count(),
  ]);
  const counts = new Map(stageCounts.map((s) => [s.stage, s._count._all]));
  const totalCases = stageCounts.reduce((n, s) => n + s._count._all, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Today</h1>
        <p className="text-sm text-slate-600">
          {formatDateOnly(today)} (Nevada time) · {totalCases} cases · {totalProperties} properties
        </p>
      </div>

      {unverifiedRules > 0 ? (
        <Alert tone="warning">
          {unverifiedRules} jurisdiction rule{unverifiedRules === 1 ? " has" : "s have"} not been verified
          against the official statute. Outreach and agreements stay blocked until they are.{" "}
          <Link href="/rules" className="font-medium underline">
            Review rules
          </Link>
        </Alert>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Pipeline by stage">
          <table className="w-full text-sm">
            <caption className="sr-only">Number of cases in each pipeline stage</caption>
            <thead>
              <tr className="text-left text-slate-600">
                <th scope="col" className="py-1 font-medium">Stage</th>
                <th scope="col" className="py-1 text-right font-medium">Cases</th>
              </tr>
            </thead>
            <tbody>
              {STAGES.map((stage) => (
                <tr key={stage} className="border-t border-slate-100">
                  <td className="py-1">{stageLabel(stage)}</td>
                  <td className="py-1 text-right tabular-nums">{counts.get(stage) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="space-y-6">
          <Card title="Ready for outreach">
            <p className="text-3xl font-semibold tabular-nums">{readyCount}</p>
            <p className="text-sm text-slate-600">
              Cases past the 24-month void period with heirs identified. Outreach drafting arrives in Phase 4.
            </p>
          </Card>
          <Card title="Next waiting-period unlocks">
            {upcomingUnlocks.length === 0 ? (
              <p className="text-sm text-slate-600">No cases are waiting.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {upcomingUnlocks.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-mono text-xs text-slate-500">{caseRef(c.caseNumber)}</span>{" "}
                      Estate of {c.owner.fullName}
                    </span>
                    <Badge tone="warn">
                      {c.eligibleContractDate ? formatDateOnly(c.eligibleContractDate) : "date unknown"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
