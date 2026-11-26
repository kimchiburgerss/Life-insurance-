/**
 * Follow-up scheduler (spec 5.6): after a first letter/email is sent, a day-21
 * and a day-45 follow-up are DRAFTED automatically — a few days early so they
 * can be reviewed on time — and each one still needs its own approval. Nothing
 * is drafted once anyone on the case replies, the person opts out, the previous
 * message was returned, or the case has left the CONTACTED stage.
 */
import "server-only";
import { prisma } from "@/lib/db";
import { addDays, todayIn, toDateOnly } from "@/lib/dates";
import { createFollowUpDraft } from "./service";
import { getOutreachSettings } from "./settings";

export async function draftDueFollowUps(today: Date = todayIn()): Promise<{ drafted: number; skipped: number }> {
  const settings = await getOutreachSettings();
  const firsts = await prisma.communication.findMany({
    where: {
      direction: "OUTBOUND",
      sequenceStep: 1,
      status: { in: ["SENT", "DELIVERED"] },
      sentAt: { not: null },
      personId: { not: null },
      case: { stage: "CONTACTED" },
    },
    select: { id: true, caseId: true, personId: true, channel: true, sentAt: true, person: { select: { doNotContact: true } } },
  });
  let drafted = 0;
  let skipped = 0;
  for (const first of firsts) {
    if (first.person?.doNotContact || (first.channel !== "MAIL" && first.channel !== "EMAIL")) continue;
    const replies = await prisma.communication.count({ where: { caseId: first.caseId, direction: "INBOUND", createdAt: { gte: first.sentAt! } } });
    if (replies > 0) continue;
    const thread = await prisma.communication.findMany({
      where: { caseId: first.caseId, personId: first.personId, channel: first.channel, direction: "OUTBOUND", sequenceStep: { gt: 1 } },
      select: { sequenceStep: true, status: true },
    });
    for (let i = 0; i < settings.followUpDays.length; i++) {
      const step = i + 2;
      const existing = thread.find((t) => t.sequenceStep === step);
      if (existing) {
        // Wait until this step has gone out before considering the next one.
        if (existing.status === "SENT" || existing.status === "DELIVERED") continue;
        break;
      }
      const due = addDays(toDateOnly(first.sentAt!), settings.followUpDays[i]!);
      if (today < addDays(due, -settings.followUpLeadDays)) break;
      try {
        await createFollowUpDraft({ caseId: first.caseId, personId: first.personId!, channel: first.channel, step, scheduledFor: due < today ? today : due });
        drafted++;
      } catch (e) {
        skipped++;
        console.warn(`[outreach] follow-up for ${first.id} step ${step} not drafted:`, e instanceof Error ? e.message : e);
      }
      break;
    }
  }
  return { drafted, skipped };
}
