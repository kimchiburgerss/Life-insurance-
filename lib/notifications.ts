import "server-only";
import type { DbClient } from "@/lib/db";
import type { NotificationKind } from "@/lib/generated/prisma/enums";

/**
 * Notify everyone who should know about a case: its assigned operator and every
 * OWNER. An identical unread notification is not repeated (no nightly spam).
 */
export async function notifyCase(
  db: DbClient,
  input: { caseId: string; kind: NotificationKind; title: string; body?: string },
): Promise<number> {
  const [c, owners] = await Promise.all([
    db.case.findUnique({ where: { id: input.caseId }, select: { assignedUserId: true } }),
    db.user.findMany({ where: { role: "OWNER" }, select: { id: true } }),
  ]);
  const recipients = [...new Set([...(c?.assignedUserId ? [c.assignedUserId] : []), ...owners.map((o) => o.id)])];
  let sent = 0;
  for (const userId of recipients) {
    const dup = await db.notification.findFirst({
      where: { userId, caseId: input.caseId, kind: input.kind, title: input.title, readAt: null },
      select: { id: true },
    });
    if (dup) continue;
    await db.notification.create({ data: { userId, caseId: input.caseId, kind: input.kind, title: input.title, body: input.body } });
    sent++;
  }
  return sent;
}
