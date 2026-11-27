import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card } from "@/components/ui";
import { requireOperator } from "@/lib/auth/session";
import { formatUsd, formatPct } from "@/lib/format";
import { computeMetrics } from "@/lib/metrics/compute";

export const metadata: Metadata = { title: "Metrics" };

const COST_LABEL = { perLetterCents: "cost per letter", perDataLookupCents: "cost per data lookup", perEsignCents: "cost per e-signature", monthlyHostingCents: "monthly hosting" } as const;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd>
        <span className="block text-2xl font-semibold tabular-nums">{value}</span>
        {hint ? <span className="block text-xs text-slate-600">{hint}</span> : null}
      </dd>
    </div>
  );
}

export default async function MetricsPage() {
  await requireOperator("case:read");
  const m = await computeMetrics();
  const max = Math.max(1, ...m.funnel.map((f) => f.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Metrics</h1>
        <p className="text-sm text-slate-600">Unit economics and the pipeline, from the app&apos;s own records.</p>
      </div>
      {m.missingCosts.length ? (
        <Alert tone="warning">
          Not entered yet: {m.missingCosts.map((k) => COST_LABEL[k]).join(", ")} — those costs count as $0 below.{" "}
          <Link href="/settings" className="font-medium underline">Enter your costs</Link>
        </Alert>
      ) : null}

      <Card title="Revenue">
        <dl className="grid gap-6 sm:grid-cols-4">
          <Stat label="Collected" value={formatUsd(m.revenue.collectedCents, { exact: true })} hint={`${m.revenue.paidInvoices} paid invoice(s)`} />
          <Stat label="Outstanding" value={formatUsd(m.revenue.outstandingCents, { exact: true })} hint="Sent, not yet paid" />
          <Stat label="Average days to payment" value={m.revenue.avgDaysToPayment === null ? "—" : m.revenue.avgDaysToPayment.toFixed(1)} hint="Invoice sent → paid" />
          <Stat label="Revenue per closed case" value={m.revenue.revenuePerClosedCents === null ? "—" : formatUsd(m.revenue.revenuePerClosedCents, { exact: true })} hint={`${m.revenue.wonCases} case(s) closed won`} />
        </dl>
      </Card>

      <Card title="Costs">
        <dl className="grid gap-6 sm:grid-cols-4">
          <Stat label="Cost per case" value={m.spend.costPerCaseCents === null ? "—" : formatUsd(m.spend.costPerCaseCents, { exact: true })} hint={`Variable costs ÷ ${m.spend.workedCases} case(s) researched`} />
          <Stat label="Cost per signed agreement" value={m.spend.costPerSignedCents === null ? "—" : formatUsd(m.spend.costPerSignedCents, { exact: true })} hint={`All costs incl. hosting ÷ ${m.spend.signedAgreements} signed`} />
          <Stat label="Break-even cases / month" value={m.spend.breakEven === null ? "—" : m.spend.breakEven.toFixed(1)} hint="Hosting ÷ (revenue − variable cost) per closed case" />
          <Stat label="Hosting so far" value={formatUsd(m.spend.hostingCents, { exact: true })} hint={`${m.spend.months.toFixed(1)} month(s) of data`} />
        </dl>
        <table className="mt-6 w-full text-sm">
          <caption className="sr-only">Variable costs</caption>
          <tbody>
            <tr className="border-t border-slate-100"><td className="py-1">AI (actual)</td><td className="py-1 text-right tabular-nums">{formatUsd(m.spend.aiCents, { exact: true })}</td></tr>
            <tr className="border-t border-slate-100"><td className="py-1">Letters ({m.spend.letters} × {formatUsd(m.costs.perLetterCents, { exact: true })})</td><td className="py-1 text-right tabular-nums">{formatUsd(m.spend.letters * m.costs.perLetterCents, { exact: true })}</td></tr>
            <tr className="border-t border-slate-100"><td className="py-1">Data lookups ({m.spend.lookups} × {formatUsd(m.costs.perDataLookupCents, { exact: true })})</td><td className="py-1 text-right tabular-nums">{formatUsd(m.spend.lookups * m.costs.perDataLookupCents, { exact: true })}</td></tr>
            <tr className="border-t border-slate-100"><td className="py-1">E-signatures ({m.spend.esigns} × {formatUsd(m.costs.perEsignCents, { exact: true })})</td><td className="py-1 text-right tabular-nums">{formatUsd(m.spend.esigns * m.costs.perEsignCents, { exact: true })}</td></tr>
            <tr className="border-t border-slate-300 font-semibold"><td className="py-1">Variable total</td><td className="py-1 text-right tabular-nums">{formatUsd(m.spend.variableCents, { exact: true })}</td></tr>
          </tbody>
        </table>
      </Card>

      <Card title="Funnel">
        <table className="w-full text-sm">
          <caption className="sr-only">Cases reaching each step, and conversion from the previous step</caption>
          <thead className="text-left text-slate-600">
            <tr>
              <th scope="col" className="py-1 font-medium">Step</th>
              <th scope="col" className="py-1 font-medium">Cases</th>
              <th scope="col" className="py-1 text-right font-medium">From previous</th>
            </tr>
          </thead>
          <tbody>
            {m.funnel.map((f) => (
              <tr key={f.label} className="border-t border-slate-100">
                <td className="w-32 py-1">{f.label}</td>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <div className="h-3 rounded bg-slate-700" style={{ width: `${Math.max(2, (f.count / max) * 100)}%` }} aria-hidden />
                    <span className="tabular-nums">{f.count}</span>
                  </div>
                </td>
                <td className="py-1 text-right tabular-nums">{f.fromPrevious === null ? "—" : formatPct(f.fromPrevious)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Counts every case that ever reached the step (from the audit log), so closed cases still count.</p>
      </Card>

      <Card title="Response rate per template">
        {m.responseRates.length === 0 ? (
          <p className="text-sm text-slate-600">No first letters or emails sent yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th scope="col" className="py-1 font-medium">Template</th>
                <th scope="col" className="py-1 text-right font-medium">Sent</th>
                <th scope="col" className="py-1 text-right font-medium">Replied</th>
                <th scope="col" className="py-1 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody>
              {m.responseRates.map((r) => (
                <tr key={r.template} className="border-t border-slate-100">
                  <td className="py-1 font-mono text-xs">{r.template}</td>
                  <td className="py-1 text-right tabular-nums">{r.sent}</td>
                  <td className="py-1 text-right tabular-nums">{r.replied}</td>
                  <td className="py-1 text-right tabular-nums">{r.rate === null ? "—" : formatPct(r.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
