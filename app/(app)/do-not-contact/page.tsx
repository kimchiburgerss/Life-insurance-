import type { Metadata } from "next";
import { Badge, Card } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AddDncForm, RemoveDncForm } from "./dnc-forms";

export const metadata: Metadata = { title: "Do not contact" };

export default async function DoNotContactPage() {
  const operator = await requireOperator("case:read");
  const entries = await prisma.doNotContact.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Do not contact</h1>
        <p className="text-sm text-slate-600">
          Honored on every case: a match by email or street address (the whole household) blocks drafting, approving and sending. Emails and
          addresses are stored only as keyed hashes.
        </p>
      </div>
      {can(operator.role, "case:write") ? (
        <Card title="Add someone">
          <AddDncForm />
        </Card>
      ) : null}
      <Card title={`Entries (${entries.length})`}>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-600">No one yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">Name</th>
                <th scope="col" className="py-1 pr-3 font-medium">Matches on</th>
                <th scope="col" className="py-1 pr-3 font-medium">Reason</th>
                <th scope="col" className="py-1 pr-3 font-medium">Added</th>
                {can(operator.role, "compliance:override") ? <th scope="col" className="py-1 font-medium">Remove</th> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3">{e.normalizedName ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <span className="flex flex-wrap gap-1">
                      {e.emailHash ? <Badge>email</Badge> : null}
                      {e.addressHash ? <Badge>address</Badge> : null}
                      {!e.emailHash && !e.addressHash ? <Badge>name only</Badge> : null}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{e.reason}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{e.createdAt.toISOString().slice(0, 10)}</td>
                  {can(operator.role, "compliance:override") ? (
                    <td className="py-2">
                      <RemoveDncForm id={e.id} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
