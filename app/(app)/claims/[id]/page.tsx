import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDateOnly, todayIn } from "@/lib/dates";
import { caseRef, formatUsd } from "@/lib/format";
import { signedFileUrl } from "@/lib/files/storage";
import { packetContext } from "@/lib/claims/service";
import { latestReviews } from "@/lib/claims/review";
import { ApprovePacketForm, AssembleForm, DocActions, FactsForm, FilingForm, ItemDecision, OperatorUpload, OutcomeForm } from "./packet-forms";

export const metadata: Metadata = { title: "Claim packet" };

const ROW_TONE: Record<string, "neutral" | "good" | "warn" | "bad"> = { ACCEPTED: "good", RECEIVED: "warn", NEEDS_REPLACEMENT: "bad", MISSING: "bad", UNDECIDED: "warn", NOT_APPLICABLE: "neutral", WAIVED: "neutral" };
const ROW_LABEL: Record<string, string> = { ACCEPTED: "accepted", RECEIVED: "to review", NEEDS_REPLACEMENT: "new copy requested", MISSING: "missing", UNDECIDED: "confirm facts", NOT_APPLICABLE: "not needed", WAIVED: "waived" };

export default async function PacketPage({ params }: PageProps<"/claims/[id]">) {
  const operator = await requireOperator("case:read");
  const { id } = await params;
  if (!(await prisma.claimPacket.findUnique({ where: { id }, select: { id: true } }))) notFound();
  const ctx = await packetContext(prisma, id);
  const reviews = await latestReviews(ctx.c.id);
  const p = ctx.packet;
  const editable = p.status === "IN_PROGRESS" || p.status === "READY_FOR_REVIEW";
  const canWrite = can(operator.role, "case:write");
  const canApprove = can(operator.role, "approval:decide");
  const today = formatDateOnly(todayIn());
  const pdfUrl = p.assembledPdfKey ? signedFileUrl(p.assembledPdfKey, { ttlSeconds: 30 * 60 }) : null;
  const events = (Array.isArray(p.events) ? p.events : []) as { at: string; type: string; detail?: string }[];
  const filing = ctx.rule.params.filing;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href={`/cases/${ctx.c.id}`} className="underline">{caseRef(ctx.c.caseNumber, ctx.c.stateCode)}</Link> / claim packet
        </p>
        <h1 className="text-2xl font-semibold">Claim packet — {ctx.person.fullName}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={p.status === "APPROVED_BY_STATE" ? "good" : p.status === "DENIED_BY_STATE" ? "bad" : "neutral"}>{p.status.toLowerCase().replaceAll("_", " ")}</Badge>
          <span className="text-slate-600">
            Estate of {ctx.c.owner.fullName} · reported {formatUsd(ctx.amountCents, { exact: true })}
            {ctx.notarize ? " · claimant signature must be notarized ($500+)" : ""}
            {p.stateClaimNumber ? ` · State claim ID ${p.stateClaimNumber}` : ""}
          </span>
        </p>
      </div>

      <Alert tone="info">
        The heir is the claimant: they sign the State&apos;s claim form{filing ? <> (online at <a className="underline" href={filing.onlineUrl} rel="noopener noreferrer">{filing.onlineUrl.replace("https://", "")}</a>, or by mail to {filing.mailingAddress.join(", ")})</> : null} and the State pays them directly. This checklist is based on an unverified rule — confirm the current requirements with the Division.
      </Alert>

      <Card title="Facts that decide which documents are needed">
        <FactsForm packetId={p.id} facts={ctx.facts} disabled={!editable || !canWrite} />
      </Card>

      <Card title="Documents">
        <ol className="space-y-4">
          {ctx.rows.map((r) => (
            <li key={r.key} className="border-t border-slate-100 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.label}</span>
                {r.form ? <Badge>form {r.form}</Badge> : null}
                {!r.inPacket ? <Badge>our file only</Badge> : null}
                <Badge tone={ROW_TONE[r.status]}>{ROW_LABEL[r.status]}</Badge>
              </div>
              <p className="text-sm text-slate-600">{r.decisionReason ? `${r.status === "WAIVED" ? "Waived" : "Not needed"}: ${r.decisionReason}` : r.why}</p>
              {r.documents.length ? (
                <ul className="mt-2 space-y-2 text-sm">
                  {r.documents.map((d) => {
                    const rev = reviews.get(d.documentId);
                    return (
                      <li key={d.documentId} className="rounded bg-slate-50 p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <a href={signedFileUrl(d.fileId, { ttlSeconds: 30 * 60 })} target="_blank" rel="noopener noreferrer" className="underline">{d.fileName}</a>
                          <span className="text-slate-500">{d.uploadedAt}</span>
                          <Badge tone={d.status === "ACCEPTED" ? "good" : d.status === "NEEDS_REPLACEMENT" ? "bad" : "warn"}>{d.status.toLowerCase().replaceAll("_", " ")}</Badge>
                        </div>
                        {rev ? (
                          <div className="mt-1 text-xs">
                            <p>
                              <span className="font-medium">AI check ({rev.model}, {rev.at}):</span> {rev.review.summary}
                            </p>
                            {[...rev.flags, ...rev.review.issues].map((f, i) => (
                              <p key={i} className={f.severity === "high" ? "text-red-800" : f.severity === "medium" ? "text-amber-800" : "text-slate-600"}>
                                {f.severity}: {f.message}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {canWrite && editable && d.status !== "ACCEPTED" ? (
                          <div className="mt-2">
                            <DocActions packetId={p.id} documentId={d.documentId} aiRunId={rev?.runId ?? null} showReview={!rev} />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {canWrite && editable && r.required && r.key !== "agreement_copy" && !["ACCEPTED"].includes(r.status) ? (
                <div className="mt-2">
                  <ItemDecision packetId={p.id} itemKey={r.key} current={r.decisionReason ? r.status : null} canWaive={canApprove} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {canWrite && editable ? (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold">Add a document you received by mail or in person</h3>
            <OperatorUpload packetId={p.id} items={ctx.rows.filter((r) => r.inPacket).map((r) => ({ key: r.key, label: r.label }))} />
          </div>
        ) : null}
      </Card>

      <Card title="Packet PDF">
        {!ctx.readiness.ready && editable ? (
          <ul className="mb-3 list-disc pl-5 text-sm text-slate-700">
            {ctx.readiness.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}
        {canWrite && editable ? <AssembleForm packetId={p.id} ready={ctx.readiness.ready} /> : null}
        {pdfUrl ? (
          <div className="mt-4 space-y-3">
            <iframe title="Claim packet PDF" src={pdfUrl} className="h-[48rem] w-full rounded border border-slate-300 bg-white" />
            <p className="text-sm">
              <a href={pdfUrl.replace("?", "?download=1&")} className="underline">Download packet</a>
            </p>
          </div>
        ) : null}
        {p.status === "READY_FOR_REVIEW" && canApprove && p.contentHash ? (
          <div className="mt-4">
            <ApprovePacketForm packetId={p.id} contentHash={p.contentHash} />
          </div>
        ) : null}
      </Card>

      {p.status === "APPROVED" && canApprove ? (
        <Card title="Record the filing">
          <FilingForm packetId={p.id} today={today} />
        </Card>
      ) : null}
      {p.status === "FILED" && canApprove ? (
        <Card title="Record the State's decision">
          <OutcomeForm packetId={p.id} today={today} />
        </Card>
      ) : null}
      {p.outcome ? (
        <Card title="Outcome">
          <p className="text-sm">
            {p.outcome.toLowerCase().replace("_", " ")} on {p.outcomeAt ? formatDateOnly(p.outcomeAt) : "?"}
            {p.outcomeNote ? ` — ${p.outcomeNote}` : ""}
          </p>
        </Card>
      ) : null}

      {events.length ? (
        <Card title="History">
          <ol className="space-y-1 text-sm">
            {events.map((e, n) => (
              <li key={n}>
                <span className="font-mono text-xs text-slate-500">{e.at.slice(0, 16).replace("T", " ")}</span> {e.type.replaceAll("_", " ")}
                {e.detail ? <span className="text-slate-600"> — {e.detail}</span> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}
