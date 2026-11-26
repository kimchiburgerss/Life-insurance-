import type { DbClient } from "@/lib/db";
import type { ActorType } from "@/lib/generated/prisma/enums";

export type Actor =
  | { type: "USER"; id: string; role?: string }
  | { type: "SYSTEM"; id: string } // e.g. "job:waiting-period-unlock", "seed"
  | { type: "AI"; id: string } // AiRun id
  | { type: "HEIR"; id: string }; // Person id (portal actions)

export type AuditEntry = {
  actor: Actor;
  action: string; // dotted verb, e.g. "case.stage_changed"
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ipAddress?: string;
};

const SENSITIVE_KEY = /(Enc$|password|secret|token|ssn|backupCodes|^email$|^phone$|mailingAddress)/i;

/**
 * Remove PII and secrets before anything is written to the audit log.
 * The audit log is append-only and cannot be purged, so it must never hold
 * heir contact details (those are purged under the retention policy).
 */
export function redactForAudit(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactForAudit);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? (v == null ? v : "[REDACTED]") : redactForAudit(v);
    }
    return out;
  }
  return value;
}

/** Append one entry. Pass the transaction client to make it atomic with the change. */
export async function writeAudit(db: DbClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorType: entry.actor.type as ActorType,
      actorId: entry.actor.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: (redactForAudit(entry.before) ?? undefined) as never,
      after: (redactForAudit(entry.after) ?? undefined) as never,
      reason: entry.reason,
      ipAddress: entry.ipAddress,
    },
  });
}
