import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { addMonths, calendarDate, formatDateOnly, todayIn } from "@/lib/dates";
import { caseRef, formatUsd } from "@/lib/format";
import { RunUnlockButton } from "./run-unlock";

export const metadata: Metadata = { title: "Waiting-period calendar" };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const operator = await requireOperator("case:read");
  const sp = await searchParams;
  const today = todayIn();
  const m = typeof sp.month === "string" ? /^(\d{4})-(\d{2})$/.exec(sp.month) : null;
  const first = m ? calendarDate(Number(m[1]), Number(m[2]), 1) : calendarDate(today.getUTCFullYear(), today.getUTCMonth() + 1, 1);
  const next = addMonths(first, 1, "clamp");
  const prev = addMonths(first, -1, "clamp");
  const monthKey = (d: Date) => formatDateOnly(d).slice(0, 7);

  const [inMonth, upcoming, overdue] = await Promise.all([
    prisma.case.findMany({
      where: { stage: "WAITING_PERIOD", eligibleContractDate: { gte: first, lt: next } },
      select: { id: true, caseNumber: true, eligibleContractDate: true, expectedValueCents: true, owner: { select: { fullName: true } } },
      orderBy: { eligibleContractDate: "asc" },
    }),
    prisma.case.findMany({
      where: { stage: "WAITING_PERIOD", eligibleContractDate: { gte: today, lt: addMonths(today, 3, "clamp") } },
      select: { id: true, caseNumber: true, eligibleContractDate: true, expectedValueCents: true, owner: { select: { fullName: true } } },
      orderBy: { eligibleContractDate: "asc" },
      take: 50,
    }),
    prisma.case.count({ where: { stage: "WAITING_PERIOD", eligibleContractDate: { lt: today } } }),
  ]);

  // Calendar grid (weeks start on Sunday).
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const byDay = new Map<number, typeof inMonth>();
  for (const c of inMonth) {
    const d = c.eligibleContractDate!.getUTCDate();
    byDay.set(d, [...(byDay.get(d) ?? []), c]);
  }
  const isToday = (d: number) => monthKey(first) === monthKey(today) && d === today.getUTCDate();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Waiting-period calendar</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Cases unlock on their eligible contract date (24 months after delivery to the state, plus one day). A nightly job
            moves them to Ready for Outreach and notifies you; anything blocked (for example an unverified rule) is reported.
          </p>
        </div>
        {can(operator.role, "case:transition:any") ? <RunUnlockButton /> : null}
      </div>
      {overdue > 0 ? (
        <p className="text-sm text-amber-900">
          {overdue} case{overdue === 1 ? " is" : "s are"} past the unlock date but still waiting — check your notifications for the reason.
        </p>
      ) : null}

      <Card
        title={
          <span className="flex items-center justify-between gap-2">
            <Link href={`/calendar?month=${monthKey(prev)}`} className="text-sm font-normal underline" aria-label="Previous month">
              ← {MONTH_NAMES[prev.getUTCMonth()]}
            </Link>
            <span>
              {MONTH_NAMES[first.getUTCMonth()]} {first.getUTCFullYear()}
            </span>
            <Link href={`/calendar?month=${monthKey(next)}`} className="text-sm font-normal underline" aria-label="Next month">
              {MONTH_NAMES[next.getUTCMonth()]} →
            </Link>
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] table-fixed border-collapse text-sm">
            <caption className="sr-only">Cases unlocking each day this month</caption>
            <thead>
              <tr>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <th key={d} scope="col" className="py-1 text-left font-medium text-slate-600">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: cells.length / 7 }, (_, w) => (
                <tr key={w}>
                  {cells.slice(w * 7, w * 7 + 7).map((d, i) => (
                    <td key={i} className={`h-24 border border-slate-100 p-1 align-top ${d && isToday(d) ? "bg-sky-50" : ""}`}>
                      {d ? <span className="text-xs text-slate-500">{d}</span> : null}
                      {d
                        ? byDay.get(d)?.map((c) => (
                            <Link key={c.id} href={`/cases/${c.id}`} className="mt-1 block truncate rounded bg-amber-100 px-1 text-xs hover:underline">
                              {caseRef(c.caseNumber)} {c.owner.fullName}
                            </Link>
                          ))
                        : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Unlocking in the next 90 days">
        {upcoming.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing unlocks in the next 90 days.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {upcoming.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/cases/${c.id}`} className="hover:underline">
                  <span className="font-mono text-xs text-slate-500">{caseRef(c.caseNumber)}</span> Estate of {c.owner.fullName}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="text-slate-600">EV {formatUsd(c.expectedValueCents)}</span>
                  <Badge tone="warn">{formatDateOnly(c.eligibleContractDate!)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
