import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { caseRef } from "@/lib/format";
import type { ChecklistItem } from "@/lib/outreach/checklist";
import { checklistPasses } from "@/lib/outreach/checklist";
import { formatPostalAddress, getBusinessProfile } from "@/lib/outreach/settings";
import { letterPreviewHtml } from "@/lib/outreach/render";
import { decryptRecipient, evaluateCommunication, storedTone } from "@/lib/outreach/service";
import { ApproveForm, CancelForm, NoteEditor, RejectForm, RetryForm } from "./message-forms";

export const metadata: Metadata = { title: "Review message" };

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "bad"> = {
  PENDING_APPROVAL: "warn",
  APPROVED: "good",
  QUEUED: "good",
  SENT: "good",
  DELIVERED: "good",
  RETURNED: "bad",
  FAILED: "bad",
  REJECTED: "bad",
  CANCELLED: "neutral",
};

function statusLabel(s: string) {
  return s.toLowerCase().replaceAll("_", " ");
}

function ChecklistView({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="space-y-2 text-sm" aria-label="Compliance checklist">
      {items.map((i) => (
        <li key={i.key} className="flex gap-2">
          <span
            aria-hidden
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
              i.status === "pass" ? "bg-emerald-700" : i.status === "warn" ? "bg-amber-600" : "bg-red-700"
            }`}
          >
            {i.status === "pass" ? "✓" : i.status === "warn" ? "!" : "✗"}
          </span>
          <span>
            <span className="font-medium">{i.label}</span>{" "}
            <span className="sr-only">({i.status === "pass" ? "passed" : i.status === "warn" ? "warning" : "failed"})</span>
            <span className="block text-slate-600">{i.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function MessagePage({ params }: PageProps<"/outreach/[id]">) {
  const operator = await requireOperator("case:read");
  const { id } = await params;
  const comm = await prisma.communication.findUnique({
    where: { id },
    include: { case: { include: { owner: { select: { fullName: true } } } }, person: { select: { fullName: true, relationship: true } } },
  });
  if (!comm || comm.direction !== "OUTBOUND" || (comm.channel !== "MAIL" && comm.channel !== "EMAIL")) notFound();
  const channel = comm.channel;
  const pending = comm.status === "PENDING_APPROVAL" || comm.status === "DRAFT";
  const [approval, business, evaluation] = await Promise.all([
    comm.approvalId ? prisma.approval.findUnique({ where: { id: comm.approvalId }, include: { approvedBy: { select: { name: true } } } }) : null,
    getBusinessProfile(),
    pending || comm.status === "APPROVED" || comm.status === "FAILED" ? evaluateCommunication(prisma, comm) : null,
  ]);
  const rejection = comm.status === "REJECTED" ? await prisma.approval.findFirst({ where: { subjectType: "COMMUNICATION", subjectId: comm.id, decision: "REJECTED" }, include: { approvedBy: { select: { name: true } } } }) : null;
  const items = evaluation?.items ?? ((approval?.checklist as ChecklistItem[] | undefined) ?? []);
  const allGreen = checklistPasses(items);
  const recipient = decryptRecipient(comm.recipientEnc);
  const tone = storedTone(comm);
  const what = channel === "MAIL" ? "Letter" : "Email";
  const preview =
    channel === "MAIL" && recipient?.kind === "MAIL" && business
      ? letterPreviewHtml(comm.renderedContent ?? "", { name: business.legalName, address: business.mailingAddress }, recipient)
      : (comm.renderedContent ?? "");
  const events = (Array.isArray(comm.events) ? comm.events : []) as { at: string; type: string; detail?: string }[];
  const canApprove = can(operator.role, "approval:decide");
  const canWrite = can(operator.role, "case:write");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/approvals" className="underline">
            Approvals
          </Link>{" "}
          /{" "}
          <Link href={`/cases/${comm.caseId}`} className="underline">
            {caseRef(comm.case.caseNumber, comm.case.stateCode)}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">
          {what} to {comm.person?.fullName ?? "unknown"} {comm.sequenceStep && comm.sequenceStep > 1 ? `(follow-up ${comm.sequenceStep - 1})` : "(first contact)"}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={STATUS_TONE[comm.status] ?? "neutral"}>{statusLabel(comm.status)}</Badge>
          <span className="text-slate-600">
            Estate of {comm.case.owner.fullName} · template {comm.templateId}@{comm.templateVersion}
            {comm.scheduledFor ? ` · send on/after ${comm.scheduledFor.toISOString().slice(0, 10)}` : ""}
            {comm.sentAt ? ` · sent ${comm.sentAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}
          </span>
        </p>
      </div>

      {comm.status === "SENT" || comm.status === "DELIVERED" ? (
        <Alert tone="info">
          Approved by {approval?.approvedBy.name ?? "the owner"} and sent {comm.sentAt?.toISOString().slice(0, 10)}
          {comm.provider ? ` (${comm.provider})` : ""}.{comm.status === "DELIVERED" ? " Delivered." : ""}
        </Alert>
      ) : null}
      {comm.status === "APPROVED" && approval ? (
        <Alert tone="info">
          Approved by {approval.approvedBy.name}. {comm.scheduledFor && comm.scheduledFor > new Date(approval.createdAt.getTime() + 60_000) ? `It will be sent on ${comm.scheduledFor.toISOString().slice(0, 10)}.` : "Sending now."}
        </Alert>
      ) : null}
      {comm.status === "FAILED" ? <Alert>Sending failed. {events.at(-1)?.detail}</Alert> : null}
      {comm.status === "CANCELLED" ? <Alert tone="info">Cancelled: {comm.cancelledReason}</Alert> : null}
      {comm.status === "REJECTED" ? (
        <Alert tone="info">
          Rejected by {rejection?.approvedBy.name ?? "owner"}: {comm.cancelledReason}
        </Alert>
      ) : null}
      {comm.status === "RETURNED" ? <Alert tone="warning">The letter was returned as undeliverable. Check the address.</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title={`${what} as it will be sent`} className="lg:col-span-3">
          <dl className="mb-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-600">To</dt>
            <dd>
              {recipient
                ? recipient.kind === "MAIL"
                  ? [recipient.name, ...formatPostalAddress(recipient.address)].join(", ")
                  : `${recipient.name} <${recipient.email}>`
                : "—"}
            </dd>
            {comm.subject ? (
              <>
                <dt className="text-slate-600">Subject</dt>
                <dd className="font-medium">{comm.subject}</dd>
              </>
            ) : null}
          </dl>
          <div className="overflow-auto rounded border border-slate-300 bg-slate-100 p-2">
            <iframe
              title={`${what} preview`}
              sandbox=""
              srcDoc={preview}
              className={`mx-auto block bg-white shadow ${channel === "MAIL" ? "lg:[zoom:0.74]" : ""}`}
              style={{ width: channel === "MAIL" ? "8.5in" : "100%", minWidth: channel === "MAIL" ? "8.5in" : undefined, height: channel === "MAIL" ? "14in" : "60rem" }}
            />
          </div>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium">Plain-text version</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 font-sans text-sm">{comm.textContent}</pre>
          </details>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card title={evaluation ? "Compliance checklist (live)" : "Checklist at approval"}>
            {items.length ? <ChecklistView items={items} /> : <p className="text-sm text-slate-600">No checklist recorded.</p>}
            {tone?.output.issues.length ? (
              <div className="mt-4 text-sm">
                <p className="font-medium">Tone check notes</p>
                <ul className="list-disc pl-5">
                  {tone.output.issues.map((i, n) => (
                    <li key={n}>
                      “{i.quote}” — {i.problem} <span className="text-slate-600">Suggestion: {i.suggestion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {pending ? (
            <Card title="Decide">
              <div className="space-y-5">
                {canWrite ? <NoteEditor commId={comm.id} initial={comm.personalNote ?? ""} /> : null}
                {canApprove ? (
                  <>
                    <ApproveForm commId={comm.id} contentHash={comm.contentHash ?? ""} allGreen={allGreen} channel={channel} />
                    <RejectForm commId={comm.id} />
                  </>
                ) : (
                  <Alert tone="info">Only the owner can approve or reject outbound messages.</Alert>
                )}
              </div>
            </Card>
          ) : null}

          {comm.status === "APPROVED" && canWrite ? (
            <Card title="Scheduled">
              <p className="mb-3 text-sm">Approved and waiting for its send date. You can still cancel it.</p>
              <CancelForm commId={comm.id} />
            </Card>
          ) : null}
          {comm.status === "FAILED" && canApprove ? (
            <Card title="Retry">
              <RetryForm commId={comm.id} />
              <div className="mt-3">
                <CancelForm commId={comm.id} />
              </div>
            </Card>
          ) : null}

          {approval ? (
            <Card title="Approval record">
              <dl className="space-y-1 text-sm">
                <div>
                  <dt className="inline text-slate-600">Approved by </dt>
                  <dd className="inline font-medium">{approval.approvedBy.name}</dd>
                </div>
                <div>
                  <dt className="inline text-slate-600">At </dt>
                  <dd className="inline">{approval.createdAt.toISOString().slice(0, 19).replace("T", " ")} UTC</dd>
                </div>
                <div>
                  <dt className="inline text-slate-600">Content hash </dt>
                  <dd className="inline break-all font-mono text-xs">{approval.contentHash}</dd>
                </div>
              </dl>
            </Card>
          ) : null}

          {events.length ? (
            <Card title="Delivery events">
              <ol className="space-y-1 text-sm">
                {events.map((e, n) => (
                  <li key={n}>
                    <span className="font-mono text-xs text-slate-500">{e.at.slice(0, 16).replace("T", " ")}</span> {e.type.replaceAll("_", " ")}
                    {e.detail ? <span className="text-slate-600"> — {e.detail}</span> : null}
                  </li>
                ))}
              </ol>
              {comm.providerMessageId ? <p className="mt-2 text-xs text-slate-600">Provider id: {comm.providerMessageId}</p> : null}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
