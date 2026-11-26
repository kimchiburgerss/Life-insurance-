import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requireOperator("audit:read");
  const entries = await prisma.auditLog.findMany({ orderBy: { id: "desc" }, take: 200 });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-slate-600">
          Append-only: the database rejects any edit or deletion of these entries. Latest 200 shown.
        </p>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">When (UTC)</th>
                <th scope="col" className="py-1 pr-3 font-medium">Actor</th>
                <th scope="col" className="py-1 pr-3 font-medium">Action</th>
                <th scope="col" className="py-1 pr-3 font-medium">Entity</th>
                <th scope="col" className="py-1 pr-3 font-medium">Change</th>
                <th scope="col" className="py-1 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id.toString()} className="border-t border-slate-100 align-top">
                  <td className="py-1 pr-3 whitespace-nowrap tabular-nums">{e.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                  <td className="py-1 pr-3">
                    {e.actorType.toLowerCase()}
                    <span className="block font-mono text-xs text-slate-500">{e.actorId}</span>
                  </td>
                  <td className="py-1 pr-3 font-mono text-xs">{e.action}</td>
                  <td className="py-1 pr-3">
                    {e.entityType}
                    <span className="block font-mono text-xs text-slate-500">{e.entityId}</span>
                  </td>
                  <td className="py-1 pr-3 font-mono text-xs">
                    {e.before ? <div>− {JSON.stringify(e.before)}</div> : null}
                    {e.after ? <div>+ {JSON.stringify(e.after)}</div> : null}
                  </td>
                  <td className="py-1">{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
