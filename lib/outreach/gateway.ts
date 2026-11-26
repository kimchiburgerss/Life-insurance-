/**
 * THE ONLY PLACE OUTREACH LEAVES THE SYSTEM (compliance rule 7).
 *
 * dispatchCommunication() sends one message, and only if:
 *  1. it is OUTBOUND and APPROVED, with an approvalId;
 *  2. that approval is for THIS communication, decision APPROVED, made by a
 *     user who (still) holds approval:decide, and its contentHash equals both
 *     the stored hash and a hash recomputed from the stored content+recipient;
 *  3. the compliance checklist, recomputed NOW, has no red item (catches an
 *     opt-out, reply or rule change between approval and sending);
 *  4. it is due (scheduledFor) and sending is not paused;
 *  5. it can be claimed atomically (APPROVED → QUEUED), so it is sent once.
 * The database enforces (1)–(2) again with a trigger (migration
 * 20261126080000_phase4_send_guards). tests/unit/no-send-without-approval.test.ts
 * fails the build if any other module imports a mail or email provider.
 */
import "server-only";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { transitionCase } from "@/lib/case/transitions";
import { prisma } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/enums";
import { caseRef } from "@/lib/format";
import { notifyCase } from "@/lib/notifications";
import { getEmailProvider } from "@/adapters/email";
import { getMailProvider } from "@/adapters/mail";
import { contentHashOf } from "./render";
import { decryptRecipient, evaluateCommunication } from "./service";
import { getBusinessProfile, getOutreachSettings, publicAppUrl } from "./settings";

export class SendRefusedError extends Error {
  constructor(message: string) {
    super(`Not sent: ${message}`);
    this.name = "SendRefusedError";
  }
}

export type DispatchResult =
  | { status: "SENT"; providerMessageId: string }
  | { status: "NOT_DUE" | "PAUSED" | "ALREADY_CLAIMED" }
  | { status: "CANCELLED" | "FAILED"; reason: string };

type Event = { at: string; type: string; detail?: string };

function appendEvent(events: unknown, e: Omit<Event, "at">): Event[] {
  return [...((Array.isArray(events) ? events : []) as Event[]), { at: new Date().toISOString(), ...e }].slice(-100);
}

const GATEWAY = { type: "SYSTEM" as const, id: "outreach-gateway" };

/** Checklist items whose failure means the message must never go (cancel rather than fail). */
const CANCEL_ON = new Set(["do_not_contact", "sequence", "case_stage", "recipient"]);

export async function dispatchCommunication(commId: string, opts: { now?: Date } = {}): Promise<DispatchResult> {
  const now = opts.now ?? new Date();
  const comm = await prisma.communication.findUnique({ where: { id: commId } });
  if (!comm) throw new SendRefusedError("communication not found.");
  if (comm.direction !== "OUTBOUND") throw new SendRefusedError("only outbound messages can be sent.");
  if (comm.channel !== "MAIL" && comm.channel !== "EMAIL") throw new SendRefusedError("only letters and emails can be sent.");
  if (comm.status !== "APPROVED") throw new SendRefusedError(`status is ${comm.status}, not APPROVED.`);
  if (!comm.approvalId || !comm.contentHash) throw new SendRefusedError("there is no approval record.");

  const approval = await prisma.approval.findUnique({ where: { id: comm.approvalId }, include: { approvedBy: { select: { role: true } } } });
  if (!approval) throw new SendRefusedError("the approval record is missing.");
  if (approval.subjectType !== "COMMUNICATION" || approval.subjectId !== comm.id) throw new SendRefusedError("the approval is for a different item.");
  if (approval.decision !== "APPROVED") throw new SendRefusedError("the item was not approved.");
  if (!can((approval.approvedBy.role ?? "VIEWER") as Role, "approval:decide")) throw new SendRefusedError("the approver is not allowed to approve outbound messages.");
  const recipient = decryptRecipient(comm.recipientEnc);
  if (!recipient || recipient.kind !== comm.channel) throw new SendRefusedError("the recipient is missing.");
  const recomputed = contentHashOf({ channel: comm.channel, recipient, subject: comm.subject, html: comm.renderedContent ?? "", text: comm.textContent ?? "" });
  if (approval.contentHash !== comm.contentHash || recomputed !== comm.contentHash) {
    throw new SendRefusedError("the content does not match what was approved.");
  }

  if (comm.scheduledFor && comm.scheduledFor > now) return { status: "NOT_DUE" };
  const settings = await getOutreachSettings();
  if (settings.sendingPaused) return { status: "PAUSED" };

  // Re-check compliance at send time.
  const { items } = await evaluateCommunication(prisma, comm);
  const failing = items.filter((i) => i.status === "fail");
  if (failing.length) {
    const reason = failing.map((i) => `${i.label}: ${i.detail}`).join(" ");
    const cancel = failing.some((i) => CANCEL_ON.has(i.key));
    await prisma.communication.update({
      where: { id: comm.id },
      data: {
        status: cancel ? "CANCELLED" : "FAILED",
        cancelledReason: cancel ? reason.slice(0, 300) : null,
        events: appendEvent(comm.events, { type: cancel ? "cancelled_at_send" : "blocked_at_send", detail: reason.slice(0, 500) }) as never,
      },
    });
    await writeAudit(prisma, { actor: GATEWAY, action: cancel ? "communication.cancelled_at_send" : "communication.blocked_at_send", entityType: "Communication", entityId: comm.id, reason: reason.slice(0, 1000) });
    if (!cancel) await notifyCase(prisma, { caseId: comm.caseId, kind: "SEND_FAILED", title: "An approved message was held back", body: reason.slice(0, 300) });
    return { status: cancel ? "CANCELLED" : "FAILED", reason };
  }

  const business = await getBusinessProfile();
  if (!business) throw new SendRefusedError("the business profile is missing.");
  const provider = comm.channel === "MAIL" ? getMailProvider() : getEmailProvider();
  if (!provider) throw new SendRefusedError(`no ${comm.channel === "MAIL" ? "mail" : "email"} service is configured.`);

  // Claim: exactly one dispatcher gets to send.
  const claimed = await prisma.communication.updateMany({ where: { id: comm.id, status: "APPROVED" }, data: { status: "QUEUED" } });
  if (claimed.count !== 1) return { status: "ALREADY_CLAIMED" };

  try {
    const c = await prisma.case.findUniqueOrThrow({ where: { id: comm.caseId }, select: { caseNumber: true, stateCode: true } });
    let providerMessageId: string;
    if (recipient.kind === "MAIL") {
      const mail = getMailProvider()!;
      const r = await mail.sendLetter({
        idempotencyKey: comm.id,
        to: { name: recipient.name, ...recipient.address },
        from: { name: business.legalName, ...business.mailingAddress },
        html: comm.renderedContent!,
        description: `${caseRef(c.caseNumber, c.stateCode)} step ${comm.sequenceStep ?? 1}`,
        metadata: { communication_id: comm.id },
      });
      providerMessageId = r.providerMessageId;
    } else {
      const email = getEmailProvider()!;
      const unsubscribe = `${publicAppUrl()}/api/unsubscribe/${comm.optOutToken}`;
      const r = await email.send({
        from: { name: `${business.contactName} (${business.legalName})`, address: business.email },
        to: { name: recipient.name, address: recipient.email },
        replyTo: business.email,
        subject: comm.subject!,
        html: comm.renderedContent!,
        text: comm.textContent!,
        headers: {
          "List-Unsubscribe": `<${unsubscribe}>, <mailto:${business.email}?subject=STOP>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      providerMessageId = r.providerMessageId;
    }
    await prisma.communication.update({
      where: { id: comm.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        provider: provider.id,
        providerMessageId,
        deliveryStatus: "sent",
        events: appendEvent(comm.events, { type: "sent", detail: provider.name }) as never,
      },
    });
    await writeAudit(prisma, {
      actor: GATEWAY,
      action: "communication.sent",
      entityType: "Communication",
      entityId: comm.id,
      after: { caseId: comm.caseId, approvalId: approval.id, approvedById: approval.approvedById, contentHash: comm.contentHash, channel: comm.channel, step: comm.sequenceStep, provider: provider.id, providerMessageId },
    });
    const stage = await prisma.case.findUniqueOrThrow({ where: { id: comm.caseId }, select: { stage: true } });
    if (stage.stage === "READY_FOR_OUTREACH") {
      await transitionCase({ caseId: comm.caseId, to: "CONTACTED", actor: GATEWAY, reason: "First approved message sent." }).catch(async (e) => {
        await notifyCase(prisma, { caseId: comm.caseId, kind: "SEND_FAILED", title: "Message sent, but the case could not move to Contacted", body: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      });
    }
    return { status: "SENT", providerMessageId };
  } catch (e) {
    const detail = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.communication.update({
      where: { id: comm.id },
      data: { status: "FAILED", events: appendEvent(comm.events, { type: "send_failed", detail }) as never },
    });
    await writeAudit(prisma, { actor: GATEWAY, action: "communication.send_failed", entityType: "Communication", entityId: comm.id, reason: detail });
    await notifyCase(prisma, { caseId: comm.caseId, kind: "SEND_FAILED", title: `${comm.channel === "MAIL" ? "Letter" : "Email"} failed to send`, body: detail.slice(0, 300) });
    return { status: "FAILED", reason: detail };
  }
}

/** Send every approved message that is due (runs every few minutes). */
export async function dispatchDue(now = new Date()): Promise<{ sent: number; other: number }> {
  const due = await prisma.communication.findMany({
    where: { direction: "OUTBOUND", status: "APPROVED", OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
    select: { id: true },
    orderBy: { scheduledFor: "asc" },
    take: 100,
  });
  let sent = 0;
  let other = 0;
  for (const d of due) {
    try {
      const r = await dispatchCommunication(d.id, { now });
      if (r.status === "SENT") sent++;
      else other++;
    } catch (e) {
      other++;
      console.error(`[outreach] ${d.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { sent, other };
}
