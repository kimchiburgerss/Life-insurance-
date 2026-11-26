import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, Card } from "@/components/ui";
import { requireOperator } from "@/lib/auth/session";
import { STAGES, stageLabel } from "@/lib/case/stateMachine";
import { prisma } from "@/lib/db";
import { addDays, formatDateOnly, todayIn } from "@/lib/dates";
import { caseRef, formatUsd } from "@/lib/format";
import { getBusinessProfile } from "@/lib/outreach/settings";

export const metadata: Metadata = { title: "Today" };


export default async function TodayPage() {
  await requireOperator("case:read");
  const today = todayIn();

  // End of the 7th day from today (Nevada calendar date at UTC midnight + 8 days).
  const weekAhead = addDays(today, 8);
  const [stageCounts, unverifiedRules, upcomingUnlocks, readyCount, totalProperties, topByValue, reviewCount, screeningCount, runningImports, approvalsWaiting, followUpsDue, failedSends, businessProfile] = await Promise.all([
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
    prisma.case.findMany({
      where: { stage: { notIn: ["CLOSED_WON", "CLOSED_NO_HEIR", "CLOSED_DECLINED", "CLOSED_SELF_CLAIMED", "CLOSED_INELIGIBLE"] }, expectedValueCents: { not: null } },
      orderBy: { expectedValueCents: "desc" },
      take: 8,
      select: { id: true, caseNumber: true, stage: true, expectedValueCents: true, priorityScore: true, owner: { select: { fullName: true } } },
    }),
    prisma.ownerMatchCandidate.count({ where: { status: "PENDING" } }),
    prisma.case.count({ where: { stage: "IMPORTED" } }),
    prisma.importBatch.count({ where: { status: { in: ["QUEUED", "PROCESSING"] } } }),
    prisma.communication.count({ where: { direction: "OUTBOUND", status: "PENDING_APPROVAL" } }),
    prisma.communication.findMany({
      where: { direction: "OUTBOUND", sequenceStep: { gt: 1 }, status: { in: ["PENDING_APPROVAL", "APPROVED"] }, scheduledFor: { lte: weekAhead } },
      orderBy: { scheduledFor: "asc" },
      take: 10,
      select: { id: true, status: true, scheduledFor: true, channel: true, person: { select: { fullName: true } }, case: { select: { caseNumber: true } } },
    }),
    prisma.communication.count({ where: { direction: "OUTBOUND", status: "FAILED" } }),
    getBusinessProfile(),
  ]);
  const [docsToReview, agreementsOut] = await Promise.all([
    prisma.heirDocument.findMany({
      where: { status: "RECEIVED" },
      orderBy: { createdAt: "asc" },
      take: 8,
      select: { id: true, caseId: true, checklistKey: true, createdAt: true, person: { select: { fullName: true } }, case: { select: { caseNumber: true } } },
    }),
    prisma.agreement.count({ where: { status: "SENT" } }),
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

      {!businessProfile ? (
        <Alert tone="warning">
          Set up your business profile (name, a real contact person, postal address, phone) before drafting letters.{" "}
          <Link href="/settings" className="font-medium underline">
            Settings
          </Link>
        </Alert>
      ) : null}
      {failedSends > 0 ? (
        <Alert>
          {failedSends} approved message{failedSends === 1 ? "" : "s"} failed to send.{" "}
          <Link href="/approvals" className="font-medium underline">
            Review
          </Link>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Approvals waiting">
          <p className="text-3xl font-semibold tabular-nums">{approvalsWaiting}</p>
          <Link href="/approvals" className="text-sm underline">Open approval queue</Link>
        </Card>
        <Card title="Follow-ups due this week">
          {followUpsDue.length === 0 ? (
            <p className="text-sm text-slate-600">None.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {followUpsDue.map((f) => (
                <li key={f.id}>
                  <Link href={`/outreach/${f.id}`} className="underline">
                    {f.scheduledFor?.toISOString().slice(0, 10)} · {caseRef(f.case.caseNumber)} · {f.channel === "MAIL" ? "letter" : "email"} to {f.person?.fullName}
                  </Link>{" "}
                  <Badge tone={f.status === "APPROVED" ? "good" : "warn"}>{f.status === "APPROVED" ? "approved" : "needs approval"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Documents to review">
          {docsToReview.length === 0 ? (
            <p className="text-sm text-slate-600">None.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {docsToReview.map((d) => (
                <li key={d.id}>
                  <Link href={`/cases/${d.caseId}`} className="underline">
                    {caseRef(d.case.caseNumber)} · {d.checklistKey.replaceAll("_", " ")} from {d.person.fullName}
                  </Link>{" "}
                  <span className="text-slate-500">{d.createdAt.toISOString().slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Agreements out for signature">
          <p className="text-3xl font-semibold tabular-nums">{agreementsOut}</p>
          <Link href="/pipeline" className="text-sm underline">Pipeline</Link>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="To screen">
          <p className="text-3xl font-semibold tabular-nums">{screeningCount}</p>
          <Link href="/screening" className="text-sm underline">Open screening queue</Link>
        </Card>
        <Card title="Possible duplicate owners">
          <p className="text-3xl font-semibold tabular-nums">{reviewCount}</p>
          <Link href="/review" className="text-sm underline">Open review queue</Link>
        </Card>
        <Card title="Imports running">
          <p className="text-3xl font-semibold tabular-nums">{runningImports}</p>
          <Link href="/imports" className="text-sm underline">Imports</Link>
        </Card>
      </div>

      <Card title="Top open cases by expected value">
        {topByValue.length === 0 ? (
          <p className="text-sm text-slate-600">No cases with a disclosed amount yet.</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Open cases ranked by expected value</caption>
            <thead className="text-left text-slate-600">
              <tr>
                <th scope="col" className="py-1 font-medium">Case</th>
                <th scope="col" className="py-1 font-medium">Stage</th>
                <th scope="col" className="py-1 text-right font-medium">Score</th>
                <th scope="col" className="py-1 text-right font-medium">Expected value</th>
              </tr>
            </thead>
            <tbody>
              {topByValue.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-1">
                    <Link href={`/cases/${c.id}`} className="underline">{c.owner.fullName}</Link>{" "}
                    <span className="font-mono text-xs text-slate-500">{caseRef(c.caseNumber)}</span>
                  </td>
                  <td className="py-1">{stageLabel(c.stage)}</td>
                  <td className="py-1 text-right tabular-nums">{c.priorityScore ?? "—"}</td>
                  <td className="py-1 text-right font-semibold tabular-nums">{formatUsd(c.expectedValueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

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
              Cases past the 24-month void period with heirs identified. Draft letters from each case page.
            </p>
          </Card>
          <Card title="Next waiting-period unlocks">
            {upcomingUnlocks.length === 0 ? (
              <p className="text-sm text-slate-600">No cases are waiting.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {upcomingUnlocks.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/cases/${c.id}`} className="hover:underline">
                      <span className="font-mono text-xs text-slate-500">{caseRef(c.caseNumber)}</span>{" "}
                      Estate of {c.owner.fullName}
                    </Link>
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
