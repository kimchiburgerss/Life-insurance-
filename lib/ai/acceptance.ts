import "server-only";
import { writeAudit } from "@/lib/audit";
import type { DbClient } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/enums";

export class AiDecisionError extends Error {}

/**
 * Record a human decision on an AI suggestion (build spec §6: AI output is a
 * suggestion until a human accepts it). Accepted suggestions are audited.
 */
export async function decideAiRun(
  db: DbClient,
  input: { aiRunId: string; decision: "ACCEPTED" | "REJECTED"; actor: { id: string; role: Role }; note?: string },
) {
  const run = await db.aiRun.findUniqueOrThrow({ where: { id: input.aiRunId } });
  if (run.status !== "SUCCEEDED") throw new AiDecisionError("Only successful AI runs can be accepted or rejected.");
  if (run.acceptance !== "PENDING") throw new AiDecisionError("This suggestion has already been decided.");
  const updated = await db.aiRun.update({
    where: { id: run.id },
    data: { acceptance: input.decision, decidedById: input.actor.id, decidedAt: new Date() },
  });
  await writeAudit(db, {
    actor: { type: "USER", id: input.actor.id, role: input.actor.role },
    action: input.decision === "ACCEPTED" ? "ai.suggestion_accepted" : "ai.suggestion_rejected",
    entityType: run.entityType ?? "AiRun",
    entityId: run.entityId ?? run.id,
    after: { aiRunId: run.id, prompt: `${run.promptName}@${run.promptVersion}`, model: run.model },
    reason: input.note,
  });
  return updated;
}
