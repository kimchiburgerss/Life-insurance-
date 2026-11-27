import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { caseRef, formatUsd } from "@/lib/format";
import { checklistPasses, type ChecklistItem } from "@/lib/outreach/checklist";
import { formatBps } from "@/lib/rules/engine";
import { signedFileUrl } from "@/lib/files/storage";
import { agreementReference, evaluateAgreement, signerOf } from "@/lib/agreements/service";
import { esignProviderStatus } from "@/adapters/esign/status";
import { ApproveAgreementForm, CancelAgreementForm, PaperSignatureForm, RejectAgreementForm, RetryAgreementForm } from "./agreement-forms";
import { formatNevadaDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Agreement" };

const TONE: Record<string, "neutral" | "good" | "warn" | "bad"> = { PENDING_APPROVAL: "warn", APPROVED: "good", SENT: "good", SIGNED: "good", DECLINED: "bad", VOIDED: "bad", CANCELLED: "neutral" };

function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="space-y-2 text-sm" aria-label="Agreement checks">
      {items.map((i) => (
        <li key={i.key} className="flex gap-2">
          <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${i.status === "pass" ? "bg-emerald-700" : i.status === "warn" ? "bg-amber-600" : "bg-red-700"}`}>
            {i.status === "pass" ? "✓" : i.status === "warn" ? "!" : "✗"}
          </span>
          <span>
            <span className="font-medium">{i.label}</span> <span className="sr-only">({i.status})</span>
            <span className="block text-slate-600">{i.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function AgreementPage({ params }: PageProps<"/agreements/[id]">) {
  const operator = await requireOperator("case:read");
  const { id } = await params;
  const a = await prisma.agreement.findUnique({ where: { id }, include: { case: { include: { owner: { select: { fullName: true } } } } } });
  if (!a) notFound();
  const pending = a.status === "PENDING_APPROVAL";
  const live = pending || a.status === "APPROVED";
  const [items, approval] = await Promise.all([
    live ? evaluateAgreement(prisma, a) : Promise.resolve(null),
    a.approvalId ? prisma.approval.findUnique({ where: { id: a.approvalId }, include: { approvedBy: { select: { name: true } } } }) : null,
  ]);
  const shown = items ?? ((approval?.checklist as ChecklistItem[] | undefined) ?? []);
  const signer = signerOf(a);
  const ref = agreementReference(a);
  const pdfUrl = a.pdfFileKey ? signedFileUrl(a.pdfFileKey, { ttlSeconds: 30 * 60 }) : null;
  const signedUrl = a.signedFileKey ? signedFileUrl(a.signedFileKey, { ttlSeconds: 30 * 60 }) : null;
  const events = (Array.isArray(a.events) ? a.events : []) as { at: string; type: string; detail?: string }[];
  const canApprove = can(operator.role, "approval:decide");
  const canWrite = can(operator.role, "case:write");
  const esign = esignProviderStatus();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/approvals" className="underline">Approvals</Link> /{" "}
          <Link href={`/cases/${a.caseId}`} className="underline">{caseRef(a.case.caseNumber, a.case.stateCode)}</Link>
        </p>
        <h1 className="text-2xl font-semibold">Agreement {ref} with {signer.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={TONE[a.status] ?? "neutral"}>{a.status.toLowerCase().replaceAll("_", " ")}</Badge>
          {a.isAttorneyApprovedTemplate ? <Badge tone="good">attorney-approved text</Badge> : <Badge tone="warn">DRAFT text</Badge>}
          <span className="text-slate-600">
            Estate of {a.case.owner.fullName} · fee {formatBps(a.feeBps)} (cap {a.feeCapBps != null ? formatBps(a.feeCapBps) : "?"}) · value {formatUsd(a.propertyValueBeforeFeeCents, { exact: true })} → {formatUsd(a.propertyValueAfterFeeCents, { exact: true })} after fee
          </span>
        </p>
      </div>

      {a.status === "SENT" ? <Alert tone="info">Sent {formatNevadaDate(a.sentAt)} for {a.signatureMethod === "PAPER" ? "paper signature — print it, mail it, and record the signed copy below" : `electronic signature (${a.esignProvider})`}.</Alert> : null}
      {a.status === "SIGNED" ? <Alert tone="info">Signed {formatNevadaDate(a.signedAt)}.</Alert> : null}
      {a.statusReason ? <Alert tone="warning">{a.statusReason}</Alert> : null}
      {a.status === "APPROVED" && events.at(-1)?.type === "send_failed" ? <Alert>Sending failed: {events.at(-1)?.detail}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Agreement as it will be signed" className="lg:col-span-3">
          <p className="mb-2 text-sm [overflow-wrap:anywhere]">Signer: {signer.name}{signer.email ? ` <${signer.email}>` : " (no email on file)"}</p>
          {pdfUrl ? (
            <>
              <iframe title="Agreement PDF" src={pdfUrl} className="h-[52rem] w-full rounded border border-slate-300 bg-white" />
              <p className="mt-2 text-sm">
                <a href={pdfUrl.replace("?", "?download=1&")} className="underline">Download PDF</a>
                {signedUrl ? <> · <a href={signedUrl} className="underline">Signed copy</a></> : null}
              </p>
            </>
          ) : null}
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium">Text version</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 font-sans text-sm">{a.textContent}</pre>
          </details>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card title={items ? "Checks (live)" : "Checks at approval"}>
            <Checklist items={shown} />
          </Card>
          {pending ? (
            <Card title="Decide">
              {canApprove ? (
                <div className="space-y-5">
                  <ApproveAgreementForm id={a.id} contentHash={a.contentHash ?? ""} allGreen={checklistPasses(shown)} hasEmail={Boolean(signer.email)} esignReady={esign.ok} />
                  <RejectAgreementForm id={a.id} />
                </div>
              ) : (
                <Alert tone="info">Only the owner can approve or reject agreements.</Alert>
              )}
            </Card>
          ) : null}
          {a.status === "APPROVED" && canApprove ? (
            <Card title="Not sent yet">
              <RetryAgreementForm id={a.id} />
            </Card>
          ) : null}
          {a.status === "SENT" && a.signatureMethod === "PAPER" && canApprove ? (
            <Card title="Record the paper signature">
              <PaperSignatureForm id={a.id} />
            </Card>
          ) : null}
          {canWrite && ["PENDING_APPROVAL", "APPROVED", "SENT"].includes(a.status) ? (
            <Card title="Cancel">
              <CancelAgreementForm id={a.id} />
            </Card>
          ) : null}
          {approval ? (
            <Card title="Approval record">
              <p className="text-sm">
                Approved by <strong>{approval.approvedBy.name}</strong> at {approval.createdAt.toISOString().slice(0, 19).replace("T", " ")} UTC ({approval.reason}).
              </p>
              <p className="mt-1 break-all font-mono text-xs">{approval.contentHash}</p>
            </Card>
          ) : null}
          {events.length ? (
            <Card title="Events">
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
      </div>
    </div>
  );
}
