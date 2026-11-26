import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { stageLabel } from "@/lib/case/stateMachine";
import { previewTransitions } from "@/lib/case/transitions";
import { prisma } from "@/lib/db";
import { formatDateOnly } from "@/lib/dates";
import { caseRef, formatPct, formatUsd, scoreTone } from "@/lib/format";
import { formatMicros } from "@/lib/ai/pricing";
import { suggestIntestateHeirs } from "@/lib/research/intestate";
import { ObituaryExtraction, quoteAppears } from "@/lib/research/obituary";
import { assessExtraction, caseAiCostMicros, possibleDuplicates, ResearchSummary, TracingEstimate } from "@/lib/research/service";
import { getActiveRule } from "@/lib/rules/repository";
import { todayIn } from "@/lib/dates";
import { FamilyTree } from "./family-tree";
import { EvidencePanel, ExtractionReview, PeoplePanel, SummaryPanel, TracingPanel } from "./research-panels";
import { TransitionPanel } from "./transition-panel";

export const metadata: Metadata = { title: "Case" };

export default async function CasePage({ params }: PageProps<"/cases/[id]">) {
  const operator = await requireOperator("case:read");
  const { id } = await params;
  const c = await prisma.case.findUnique({
    where: { id },
    include: {
      owner: true,
      assignedUser: { select: { name: true } },
      properties: { orderBy: { reportedAmountCents: { sort: "desc", nulls: "last" } } },
      _count: { select: { evidence: true, persons: true, communications: true } },
    },
  });
  if (!c) notFound();
  const canWrite = can(operator.role, "case:write");
  const [preview, timeline, evidence, persons, aiRuns, duplicates, aiCost, intestateRule] = await Promise.all([
    previewTransitions(c.id, operator.role),
    prisma.auditLog.findMany({ where: { entityType: "Case", entityId: c.id }, orderBy: { id: "desc" }, take: 50 }),
    prisma.evidence.findMany({ where: { caseId: c.id }, orderBy: { createdAt: "asc" } }),
    prisma.person.findMany({ where: { caseId: c.id }, orderBy: [{ relationship: "asc" }, { fullName: "asc" }] }),
    prisma.aiRun.findMany({ where: { caseId: c.id, status: "SUCCEEDED" }, orderBy: { createdAt: "desc" }, take: 50 }),
    possibleDuplicates(c.id),
    caseAiCostMicros(c.id),
    getActiveRule(prisma, c.stateCode, "INTESTATE_SUCCESSION", todayIn()).catch(() => null),
  ]);
  const pendingExtractions = aiRuns.filter((r) => r.promptName === "obituary-extraction" && r.acceptance === "PENDING");
  const reviews = await Promise.all(
    pendingExtractions.map(async (r) => {
      const output = ObituaryExtraction.parse(r.output);
      const ev = evidence.find((e) => e.id === r.entityId);
      return {
        runId: r.id,
        model: r.model,
        evidenceTitle: ev?.title ?? "source",
        output,
        match: await assessExtraction(c.id, output),
        quoteFound: output.relatives.map((x) => quoteAppears(x.evidenceQuote, ev?.rawText ?? "")),
      };
    }),
  );
  const latestSummary = aiRuns.find((r) => r.promptName === "research-summary" && r.acceptance !== "REJECTED");
  const pendingTracing = aiRuns.find((r) => r.promptName === "tracing-difficulty" && r.acceptance === "PENDING");
  const accepted = c.tracingAssessment as { difficulty: number; rationale: string } | null;
  const intestate = intestateRule
    ? suggestIntestateHeirs(
        persons.map((p) => ({ id: p.id, name: p.fullName, relationship: p.relationship, isPredeceased: p.isPredeceased, rejected: p.status === "REJECTED", parentPersonId: p.parentPersonId })),
        intestateRule.params,
      )
    : null;
  const personRows = persons.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    relationship: p.relationship,
    status: p.status,
    isPredeceased: p.isPredeceased,
    confidence: p.relationshipConfidence,
    parentPersonId: p.parentPersonId,
    sources: p.sourceEvidenceIds.length,
    notes: p.notes,
    hasAddress: Boolean(p.mailingAddressEnc),
    hasEmail: Boolean(p.emailEnc),
    hasPhone: Boolean(p.phoneEnc),
  }));
  const factors = (Array.isArray(c.priorityFactors) ? c.priorityFactors : []) as { label: string; points: number }[];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/pipeline" className="underline">
            Pipeline
          </Link>{" "}
          / {caseRef(c.caseNumber, c.stateCode)}
        </p>
        <h1 className="text-2xl font-semibold">Estate of {c.owner.fullName}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <Badge>{stageLabel(c.stage)}</Badge>
          <Badge tone={scoreTone(c.priorityScore)}>score {c.priorityScore ?? "—"}</Badge>
          <span className="text-slate-600">
            {c.assignedUser ? `Assigned to ${c.assignedUser.name}` : "Unassigned"} · stage since {c.stageChangedAt.toISOString().slice(0, 10)}
          </span>
        </p>
      </div>

      {preview.eligibility.status === "UNKNOWN" ? (
        <Alert tone="warning">{preview.eligibility.reason}</Alert>
      ) : preview.eligibility.status === "WAITING" ? (
        <Alert tone="info">
          24-month void period: research is fine, but no outreach or agreement until{" "}
          <strong>{formatDateOnly(preview.eligibility.eligibleContractDate)}</strong> ({preview.eligibility.daysRemaining} days).
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Value" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Reported total</dt>
              <dd className="font-semibold tabular-nums">{formatUsd(c.estimatedValueCents)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Estimated success</dt>
              <dd className="tabular-nums">{formatPct(c.successProbability)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Expected value</dt>
              <dd className="font-semibold tabular-nums">{formatUsd(c.expectedValueCents)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">AI cost so far</dt>
              <dd className="tabular-nums">{formatMicros(aiCost)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Eligible contract date</dt>
              <dd className="tabular-nums">{c.eligibleContractDate ? formatDateOnly(c.eligibleContractDate) : "unknown"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-600">
            Expected value = reported amount × legal fee cap at the earliest signing date × estimated success. Success
            estimates are starting assumptions until real outcomes are tracked.
          </p>
        </Card>

        <Card title="Why this priority" className="lg:col-span-2">
          {factors.length === 0 ? (
            <p className="text-sm text-slate-600">Not scored yet.</p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Score factors</caption>
              <tbody>
                {factors.map((f, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className={`w-14 py-1 text-right font-mono tabular-nums ${f.points < 0 ? "text-red-800" : "text-emerald-800"}`}>
                      {f.points > 0 ? `+${f.points}` : f.points}
                    </td>
                    <td className="py-1 pl-3">{f.label}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-300 font-semibold">
                  <td className="py-1 text-right font-mono">{c.priorityScore}</td>
                  <td className="py-1 pl-3">priority score (0–100)</td>
                </tr>
              </tbody>
            </table>
          )}
          <TracingPanel
            caseId={c.id}
            canWrite={canWrite}
            accepted={accepted}
            pending={pendingTracing ? { runId: pendingTracing.id, ...TracingEstimate.parse(pendingTracing.output) } : null}
          />
        </Card>
      </div>

      <Card title="Move this case">
        <TransitionPanel
          caseId={c.id}
          options={preview.options}
          canOverride={can(operator.role, "compliance:override")}
        />
      </Card>

      <Card title="Death verification & sources">
        <div className="space-y-4">
          {c.owner.deathVerified ? (
            <Alert tone="info">
              Death confirmed{c.owner.dateOfDeath ? ` (died ${formatDateOnly(c.owner.dateOfDeath)})` : ""} — {c.owner.deathVerificationNote}
            </Alert>
          ) : null}
          {reviews.map((r) => (
            <ExtractionReview key={r.runId} caseId={c.id} canWrite={canWrite} {...r} />
          ))}
          <EvidencePanel
            caseId={c.id}
            canWrite={canWrite}
            evidence={evidence.map((e) => ({
              id: e.id,
              sourceType: e.sourceType,
              title: e.title,
              url: e.url,
              supportsDeath: e.supportsDeath,
              hasText: Boolean(e.rawText),
              extracted: Boolean(e.extractedFacts),
              pendingExtraction: pendingExtractions.some((r) => r.entityId === e.id),
              addedAt: e.createdAt.toISOString().slice(0, 10),
            }))}
          />
        </div>
      </Card>

      <Card title={`Family & heirs (${persons.filter((p) => p.status !== "REJECTED").length})`}>
        <FamilyTree ownerName={c.owner.fullName} people={personRows} intestate={intestate} />
        <div className="mt-6">
          <PeoplePanel caseId={c.id} canWrite={canWrite} people={personRows} duplicates={duplicates} />
        </div>
      </Card>

      <Card title="Research summary (AI)">
        <SummaryPanel
          caseId={c.id}
          canWrite={canWrite}
          summary={
            latestSummary
              ? {
                  runId: latestSummary.id,
                  createdAt: latestSummary.createdAt.toISOString().slice(0, 16).replace("T", " "),
                  model: latestSummary.model,
                  acceptance: latestSummary.acceptance,
                  output: ResearchSummary.parse(latestSummary.output),
                }
              : null
          }
        />
      </Card>

      <Card title={`Properties (${c.properties.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">State ID</th>
                <th scope="col" className="py-1 pr-3 font-medium">As reported</th>
                <th scope="col" className="py-1 pr-3 font-medium">Holder</th>
                <th scope="col" className="py-1 pr-3 font-medium">Type</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Amount</th>
                <th scope="col" className="py-1 pr-3 font-medium">Delivered to state</th>
                <th scope="col" className="py-1 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {c.properties.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 align-top">
                  <td className="py-1 pr-3 font-mono text-xs">{p.statePropertyId}</td>
                  <td className="py-1 pr-3">
                    {p.ownerNameRaw}
                    {p.ownerAddressRaw ? <span className="block text-xs text-slate-500">{p.ownerAddressRaw}</span> : null}
                  </td>
                  <td className="py-1 pr-3">
                    {p.holderName ?? "—"}
                    {p.holderIsLifeInsurer ? <span className="block text-xs text-emerald-800">life insurer</span> : null}
                  </td>
                  <td className="py-1 pr-3">
                    {p.category.toLowerCase().replace("_", " ")}
                    {p.propertyTypeCode ? <span className="block font-mono text-xs text-slate-500">{p.propertyTypeCode}</span> : null}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {p.amountIsMinimum ? "≥ " : ""}
                    {formatUsd(p.reportedAmountCents, { exact: true })}
                  </td>
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {p.dateDeliveredToState ? formatDateOnly(p.dateDeliveredToState) : "unknown"}
                    {p.dateDeliveredPrecision && p.dateDeliveredPrecision !== "DAY" ? (
                      <span className="block text-xs text-amber-800">{p.dateDeliveredPrecision.toLowerCase()} only (end of period used)</span>
                    ) : null}
                  </td>
                  <td className="py-1">
                    <span className="flex flex-wrap gap-1">
                      {p.flags.map((f) => (
                        <Badge key={f}>{f.toLowerCase().replaceAll("_", " ")}</Badge>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-600">
          Outreach, agreements and claim documents arrive on this page in Phases 4–6.
        </p>
      </Card>

      <Card title="Timeline">
        <ol className="space-y-2 text-sm">
          {timeline.map((e) => (
            <li key={e.id.toString()} className="border-t border-slate-100 pt-2">
              <span className="font-mono text-xs text-slate-500">{e.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>{" "}
              <span className="font-medium">{e.action.replaceAll("_", " ").replaceAll(".", " · ")}</span>
              {e.before && typeof e.before === "object" && "stage" in e.before ? (
                <span>
                  {" "}
                  {stageLabel(String((e.before as { stage: string }).stage) as never)} →{" "}
                  {stageLabel(String((e.after as { stage: string }).stage) as never)}
                </span>
              ) : null}
              <span className="text-slate-600"> by {e.actorType.toLowerCase()}</span>
              {e.reason ? <span className="block text-slate-700">“{e.reason}”</span> : null}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
