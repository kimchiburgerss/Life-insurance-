import "server-only";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { notifyCase } from "@/lib/notifications";
import { cancelCommunication } from "./service";
import { interpretLobEvent, type LobEvent } from "./webhooks";

type StoredEvent = { at: string; type: string; detail?: string; eventId?: string };

/**
 * Record a (verified) Lob event on the letter it belongs to. Idempotent per
 * event id; Lob may deliver events out of order, so status only moves forward
 * (SENT → DELIVERED, and RETURNED wins).
 */
export async function applyLobEvent(ev: LobEvent): Promise<{ handled: boolean; duplicate?: boolean }> {
  if (!ev.letterId) return { handled: false };
  const comm = await prisma.communication.findFirst({ where: { provider: "lob", providerMessageId: ev.letterId } });
  if (!comm) return { handled: false };
  const events = (Array.isArray(comm.events) ? comm.events : []) as StoredEvent[];
  if (events.some((e) => e.eventId === ev.id)) return { handled: true, duplicate: true };

  const meaning = interpretLobEvent(ev.eventType);
  let status = comm.status;
  if (meaning.status === "RETURNED" && (comm.status === "SENT" || comm.status === "DELIVERED")) status = "RETURNED";
  else if (meaning.status === "DELIVERED" && comm.status === "SENT") status = "DELIVERED";

  await prisma.communication.update({
    where: { id: comm.id },
    data: {
      status,
      deliveryStatus: meaning.deliveryStatus,
      events: [...events, { at: new Date().toISOString(), type: ev.eventType, eventId: ev.id }].slice(-100) as never,
    },
  });
  if (status !== comm.status) {
    await writeAudit(prisma, {
      actor: { type: "SYSTEM", id: "lob-webhook" },
      action: status === "RETURNED" ? "communication.returned" : "communication.delivered",
      entityType: "Communication",
      entityId: comm.id,
      before: { status: comm.status },
      after: { status, eventId: ev.id, eventType: ev.eventType },
    });
  }
  if (status === "RETURNED" && comm.status !== "RETURNED") {
    const pending = await prisma.communication.findMany({
      where: { caseId: comm.caseId, personId: comm.personId, channel: "MAIL", direction: "OUTBOUND", status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] } },
      select: { id: true },
    });
    for (const p of pending) await cancelCommunication("system", p.id, "The previous letter was returned as undeliverable.");
    await notifyCase(prisma, {
      caseId: comm.caseId,
      kind: "MAIL_RETURNED",
      title: "A letter was returned as undeliverable",
      body: "Check the heir's address; pending follow-up letters to that address were cancelled.",
    });
  }
  return { handled: true };
}
