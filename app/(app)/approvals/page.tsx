import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, Card } from "@/components/ui";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { caseRef } from "@/lib/format";
import type { ChecklistItem } from "@/lib/outreach/checklist";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const operator = await requireOperator("case:read");
  const [waiting, scheduled, failed, recent] = await Promise.all([
    prisma.communication.findMany({
      where: { direction: "OUTBOUND", status: { in: ["PENDING_APPROVAL", "DRAFT"] } },
      orderBy: [{ scheduledFor: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      include: { case: { select: { caseNumber: true, stateCode: true, owner: { select: { fullName: true } } } }, person: { select: { fullName: true } } },
    }),
    prisma.communication.findMany({
      where: { direction: "OUTBOUND", status: "APPROVED" },
      orderBy: { scheduledFor: "asc" },
      include: { case: { select: { caseNumber: true, stateCode: true } }, person: { select: { fullName: true } } },
    }),
    prisma.communication.findMany({
      where: { direction: "OUTBOUND", status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      include: { case: { select: { caseNumber: true, stateCode: true } }, person: { select: { fullName: true } } },
    }),
    prisma.communication.findMany({
      where: { direction: "OUTBOUND", status: { in: ["SENT", "DELIVERED", "RETURNED", "REJECTED"] } },
      orderBy: { updatedAt: "desc" },
      take: 15,
      include: { case: { select: { caseNumber: true, stateCode: true } }, person: { select: { fullName: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="text-sm text-slate-600">
          Nothing leaves the system until the owner approves that exact letter or email (compliance rule 7).
        </p>
      </div>
      {operator.role !== "OWNER" ? <Alert tone="info">You can review and edit drafts; only the owner can approve or reject.</Alert> : null}

      <Card title={`Waiting for approval (${waiting.length})`}>
        {waiting.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing waiting. Draft letters from a case page once the case is ready for outreach.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">Case</th>
                  <th scope="col" className="py-1 pr-3 font-medium">To</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Message</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Checklist</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Send on</th>
                  <th scope="col" className="py-1 font-medium"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((m) => {
                  const items = ((m.checklist as { items?: ChecklistItem[] } | null)?.items ?? []) as ChecklistItem[];
                  const fails = items.filter((i) => i.status === "fail").length;
                  return (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="py-2 pr-3">
                        {caseRef(m.case.caseNumber, m.case.stateCode)}
                        <span className="block text-xs text-slate-500">Estate of {m.case.owner.fullName}</span>
                      </td>
                      <td className="py-2 pr-3">{m.person?.fullName ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {m.channel === "MAIL" ? "Letter" : "Email"} · {m.sequenceStep && m.sequenceStep > 1 ? `follow-up ${m.sequenceStep - 1}` : "first contact"}
                      </td>
                      <td className="py-2 pr-3">{fails === 0 ? <Badge tone="good">all green</Badge> : <Badge tone="bad">{fails} to fix</Badge>}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{m.scheduledFor ? m.scheduledFor.toISOString().slice(0, 10) : "on approval"}</td>
                      <td className="py-2">
                        <Link href={`/outreach/${m.id}`} className="font-medium underline">
                          Review
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {failed.length ? (
        <Card title={`Failed to send (${failed.length})`}>
          <ul className="space-y-1 text-sm">
            {failed.map((m) => (
              <li key={m.id}>
                <Link href={`/outreach/${m.id}`} className="underline">
                  {caseRef(m.case.caseNumber, m.case.stateCode)} — {m.channel === "MAIL" ? "letter" : "email"} to {m.person?.fullName}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={`Approved, waiting for send date (${scheduled.length})`}>
        {scheduled.length === 0 ? (
          <p className="text-sm text-slate-600">None.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {scheduled.map((m) => (
              <li key={m.id}>
                <Link href={`/outreach/${m.id}`} className="underline">
                  {m.scheduledFor?.toISOString().slice(0, 10)} — {caseRef(m.case.caseNumber, m.case.stateCode)}, {m.channel === "MAIL" ? "letter" : "email"} to {m.person?.fullName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recently decided or sent">
        <ul className="space-y-1 text-sm">
          {recent.map((m) => (
            <li key={m.id}>
              <Link href={`/outreach/${m.id}`} className="underline">
                {caseRef(m.case.caseNumber, m.case.stateCode)} — {m.channel === "MAIL" ? "letter" : "email"} to {m.person?.fullName}
              </Link>{" "}
              <Badge tone={m.status === "REJECTED" || m.status === "RETURNED" ? "bad" : "good"}>{m.status.toLowerCase()}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
