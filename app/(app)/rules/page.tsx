import type { Metadata } from "next";
import { Badge, Button, Card } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDateOnly } from "@/lib/dates";
import { setRuleVerified } from "./actions";

export const metadata: Metadata = { title: "Jurisdiction rules" };

export default async function RulesPage() {
  const operator = await requireOperator("case:read");
  const canManage = can(operator.role, "rules:manage");
  const rules = await prisma.jurisdictionRule.findMany({
    orderBy: [{ enabled: "desc" }, { stateCode: "asc" }, { ruleType: "asc" }, { version: "desc" }],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Jurisdiction rules</h1>
        <p className="max-w-3xl text-sm text-slate-600">
          These values drive the 24-month void period, fee caps and required disclosures. Check each
          one against the official current text of NRS 120A.740 and the Treasurer&apos;s investigator
          policies (ideally with Nevada counsel), then mark it verified. Disabled rows are
          placeholders showing how another state would be added.
        </p>
      </div>
      {rules.map((rule) => (
        <Card
          key={rule.id}
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span>
                {rule.stateCode} · {rule.ruleType.replaceAll("_", " ").toLowerCase()} · v{rule.version}
              </span>
              {!rule.enabled ? (
                <Badge>disabled</Badge>
              ) : rule.lastVerifiedAt ? (
                <Badge tone="good">
                  verified {formatDateOnly(rule.lastVerifiedAt)} by {rule.verifiedBy}
                </Badge>
              ) : (
                <Badge tone="bad">not verified</Badge>
              )}
            </span>
          }
        >
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-slate-600">Source</dt>
            <dd>
              {rule.sourceCitation}
              {rule.sourceUrl ? (
                <>
                  {" "}
                  (<a className="underline" href={rule.sourceUrl} target="_blank" rel="noreferrer noopener">link</a>)
                </>
              ) : null}
            </dd>
            <dt className="text-slate-600">Effective</dt>
            <dd>
              {formatDateOnly(rule.effectiveFrom)}
              {rule.effectiveTo ? ` to ${formatDateOnly(rule.effectiveTo)}` : " onward"}
            </dd>
            {rule.notes ? (
              <>
                <dt className="text-slate-600">Notes</dt>
                <dd>{rule.notes}</dd>
              </>
            ) : null}
            <dt className="text-slate-600">Parameters</dt>
            <dd>
              <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(rule.params, null, 2)}</pre>
            </dd>
          </dl>
          {canManage && rule.enabled ? (
            <form action={setRuleVerified} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="ruleId" value={rule.id} />
              <input type="hidden" name="verified" value={rule.lastVerifiedAt ? "false" : "true"} />
              <label className="flex-1 text-sm">
                <span className="block text-slate-700">Note for the audit log (what you checked)</span>
                <input name="note" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" maxLength={500} />
              </label>
              <Button type="submit" variant="secondary">
                {rule.lastVerifiedAt ? "Mark as not verified" : "Mark as verified"}
              </Button>
            </form>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
