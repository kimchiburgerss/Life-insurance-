/**
 * Re-encrypt every stored secret with the current key version
 * (`npm run keys:rotate`). Idempotent and resumable: values already on the
 * current version are skipped, so it can be stopped and re-run.
 *
 * Covered: heirs' email, phone and address; message recipients; portal-link
 * copies; every stored document. Not covered: TOTP secrets and backup codes
 * (encrypted by Better Auth with BETTER_AUTH_SECRET) and blind indexes
 * (PII_HMAC_KEY), which are hashes, not ciphertext.
 */
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { decryptBytes, encryptBytes } from "@/lib/files/crypto";
import { currentKeyVersion } from "./keys";
import { decryptPii, encryptPii } from "./pii";

const FIELDS = [
  { table: "persons", column: "emailEnc", guarded: false },
  { table: "persons", column: "phoneEnc", guarded: false },
  { table: "persons", column: "mailingAddressEnc", guarded: false },
  { table: "portal_access", column: "tokenEnc", guarded: false },
  // Approved messages: the trigger allows this only under heirfinder.key_rotation.
  { table: "communications", column: "recipientEnc", guarded: true },
] as const;

export type RotationReport = { version: number; fields: Record<string, number>; files: number };

/** `scope` limits the run to some cases (tests); production runs cover everything. */
export async function rotateEncryption(opts: { dryRun?: boolean; scope?: { caseIds: string[] } } = {}): Promise<RotationReport> {
  const version = currentKeyVersion();
  const prefix = `v${version}:`;
  const scoped = (alias = "") => (opts.scope ? Prisma.sql` AND ${Prisma.raw(alias)}"caseId" IN (${Prisma.join(opts.scope.caseIds)})` : Prisma.empty);
  const report: RotationReport = { version, fields: {}, files: 0 };

  for (const f of FIELDS) {
    const t = Prisma.raw(`"${f.table}"`);
    const c = Prisma.raw(`"${f.column}"`);
    const pending = Prisma.sql`${c} IS NOT NULL AND ${c} NOT LIKE ${`${prefix}%`}${scoped()}`;
    let done = 0;
    if (opts.dryRun) {
      const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM ${t} WHERE ${pending}`;
      report.fields[`${f.table}.${f.column}`] = Number(n);
      continue;
    }
    for (;;) {
      const rows = await prisma.$queryRaw<{ id: string; v: string }[]>`SELECT id, ${c} AS v FROM ${t} WHERE ${pending} LIMIT 200`;
      if (!rows.length) break;
      await prisma.$transaction(async (tx) => {
        if (f.guarded) await tx.$executeRaw`SELECT set_config('heirfinder.key_rotation', 'on', true)`;
        for (const r of rows) {
          await tx.$executeRaw`UPDATE ${t} SET ${c} = ${encryptPii(decryptPii(r.v))} WHERE id = ${r.id} AND ${c} = ${r.v}`;
        }
      });
      done += rows.length;
    }
    report.fields[`${f.table}.${f.column}`] = done;
  }

  const tag = Buffer.from(`v${version}`);
  const filesPending = Prisma.sql`"purgedAt" IS NULL AND substring("data" from 1 for 2) <> ${tag}${scoped()}`;
  if (opts.dryRun) {
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "stored_files" WHERE ${filesPending}`;
    report.files = Number(n);
    return report;
  }
  for (;;) {
    const ids = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "stored_files" WHERE ${filesPending} LIMIT 20`;
    if (!ids.length) break;
    for (const { id } of ids) {
      const f = await prisma.storedFile.findUniqueOrThrow({ where: { id } });
      await prisma.storedFile.update({ where: { id }, data: { data: new Uint8Array(encryptBytes(decryptBytes(f.data))) } });
      report.files++;
    }
  }
  return report;
}
