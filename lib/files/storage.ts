/**
 * Encrypted document store. Files live (encrypted) in the stored_files table,
 * so database backups include them and there is no extra service to secure.
 * The interface is small so an S3-compatible store can replace it later.
 */
import "server-only";
import { createHash } from "node:crypto";
import { prisma, type DbClient } from "@/lib/db";
import { decryptBytes, encryptBytes, hmacHex } from "./crypto";

export type FileKind = "AGREEMENT_PDF" | "AGREEMENT_SIGNED" | "HEIR_UPLOAD" | "PAPER_SIGNATURE";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function saveFile(
  db: DbClient,
  input: { caseId: string | null; kind: FileKind; fileName: string; contentType: string; bytes: Uint8Array; uploadedBy: string },
) {
  return db.storedFile.create({
    data: {
      caseId: input.caseId,
      kind: input.kind,
      fileName: input.fileName.slice(0, 200),
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      sha256: sha256Hex(input.bytes),
      data: new Uint8Array(encryptBytes(input.bytes)),
      uploadedBy: input.uploadedBy,
    },
    select: { id: true, sha256: true, sizeBytes: true, fileName: true, contentType: true, kind: true },
  });
}

export async function readFile(id: string, db: DbClient = prisma) {
  const f = await db.storedFile.findUnique({ where: { id } });
  if (!f || f.purgedAt) return null;
  const bytes = decryptBytes(f.data);
  if (sha256Hex(bytes) !== f.sha256) throw new Error(`Stored file ${id} failed its integrity check`);
  return { meta: { id: f.id, caseId: f.caseId, kind: f.kind as FileKind, fileName: f.fileName, contentType: f.contentType, sizeBytes: f.sizeBytes, sha256: f.sha256 }, bytes };
}

// ─── Signed, expiring download URLs ─────────────────────────────────────────

const DEFAULT_TTL_SECONDS = 10 * 60;

/** `/api/files/<id>?exp=<unix>&sig=<hmac>` — also requires an operator session. */
export function signedFileUrl(fileId: string, opts: { ttlSeconds?: number; now?: number; download?: boolean } = {}): string {
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const sig = hmacHex("file-url", `${fileId}.${exp}`);
  return `/api/files/${encodeURIComponent(fileId)}?exp=${exp}&sig=${sig}${opts.download ? "&download=1" : ""}`;
}

export function verifyFileSignature(fileId: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Number(exp) * 1000 < now) return false;
  const expected = hmacHex("file-url", `${fileId}.${exp}`);
  return timingSafeEqualHex(expected, sig);
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
