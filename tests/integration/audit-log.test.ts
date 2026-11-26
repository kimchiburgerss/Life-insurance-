import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

afterAll(() => prisma.$disconnect());

// Audit rows can never be deleted, so each run uses its own entity id.
const ENTITY = `append-${randomUUID()}`;

describe("audit log is append-only (compliance rule 10)", () => {
  it("accepts inserts and redacts PII", async () => {
    await writeAudit(prisma, {
      actor: { type: "SYSTEM", id: "test" },
      action: "test.inserted",
      entityType: "Test",
      entityId: ENTITY,
      after: { emailEnc: "v1:secret", note: "ok" },
    });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId: ENTITY } });
    expect(row.after).toEqual({ emailEnc: "[REDACTED]", note: "ok" });
  });

  it("rejects UPDATE through the ORM", async () => {
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId: ENTITY } });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(
      /append-only/,
    );
  });

  it("rejects DELETE through the ORM", async () => {
    await expect(prisma.auditLog.deleteMany({ where: { entityId: ENTITY } })).rejects.toThrow(/append-only/);
  });

  it("rejects raw UPDATE, DELETE and TRUNCATE", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE audit_logs SET action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE audit_logs`)).rejects.toThrow(/append-only/);
    expect(await prisma.auditLog.count({ where: { entityId: ENTITY } })).toBe(1);
  });
});
