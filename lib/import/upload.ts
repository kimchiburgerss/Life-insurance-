import "server-only";
import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { ImportMappingSchema, suggestMapping, type ImportMapping } from "./fields";
import { detectFileType, ImportFileError, MAX_UPLOAD_BYTES, parseImportFile } from "./parse";

export class DuplicateFileError extends ImportFileError {
  constructor(readonly existingBatchId: string) {
    super("This exact file was already imported.");
  }
}

/** Step 1: store the upload, read headers + a preview. Nothing is imported yet. */
export async function createImportBatch(input: {
  fileName: string;
  data: Uint8Array;
  source: string;
  createdById: string;
  allowDuplicateFile?: boolean;
}) {
  if (input.data.byteLength === 0) throw new ImportFileError("The file is empty.");
  if (input.data.byteLength > MAX_UPLOAD_BYTES) {
    throw new ImportFileError(`File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  const fileType = detectFileType(input.fileName);
  const fileSha256 = createHash("sha256").update(input.data).digest("hex");
  if (!input.allowDuplicateFile) {
    const prior = await prisma.importBatch.findFirst({
      where: { fileSha256, status: { in: ["COMPLETED", "QUEUED", "PROCESSING"] } },
      select: { id: true },
    });
    if (prior) throw new DuplicateFileError(prior.id);
  }
  const parsed = await parseImportFile(input.data, fileType);
  const preview = parsed.rows.slice(0, 10).map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v])),
  );

  const batch = await prisma.importBatch.create({
    data: {
      fileName: input.fileName.slice(0, 255),
      source: input.source.trim().slice(0, 255) || "Unspecified source",
      fileType,
      fileSha256,
      fileData: Buffer.from(input.data),
      headers: parsed.headers,
      previewRows: preview as never,
      rowCount: parsed.rows.length,
      columnMapping: { fields: suggestMapping(parsed.headers), options: { nameOrder: "AUTO", dateOrder: "MDY" } },
      createdById: input.createdById,
    },
  });
  await writeAudit(prisma, {
    actor: { type: "USER", id: input.createdById },
    action: "import.uploaded",
    entityType: "ImportBatch",
    entityId: batch.id,
    after: { fileName: batch.fileName, fileType, rows: parsed.rows.length, sha256: fileSha256 },
  });
  return batch;
}

/** Step 2: confirm the mapping (optionally save it for reuse) and mark the batch queued. */
export async function confirmImportMapping(input: {
  batchId: string;
  mapping: unknown;
  saveAs?: string;
  actorId: string;
}): Promise<ImportMapping> {
  const mapping = ImportMappingSchema.parse(input.mapping);
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: input.batchId }, select: { status: true, headers: true } });
  if (batch.status !== "UPLOADED" && batch.status !== "FAILED") throw new ImportFileError("This import has already started.");
  const unknown = Object.values(mapping.fields).filter((h) => h && !batch.headers.includes(h));
  if (unknown.length) throw new ImportFileError(`Unknown column(s): ${unknown.join(", ")}`);

  let savedId: string | undefined;
  if (input.saveAs?.trim()) {
    const saved = await prisma.columnMapping.upsert({
      where: { name: input.saveAs.trim() },
      update: { mapping, lastUsedAt: new Date() },
      create: { name: input.saveAs.trim(), mapping, createdById: input.actorId, lastUsedAt: new Date() },
    });
    savedId = saved.id;
  }
  await prisma.importBatch.update({
    where: { id: input.batchId },
    data: { columnMapping: mapping, columnMappingId: savedId, status: "QUEUED", failureMessage: null },
  });
  await writeAudit(prisma, {
    actor: { type: "USER", id: input.actorId },
    action: "import.queued",
    entityType: "ImportBatch",
    entityId: input.batchId,
    after: { mapping: mapping.fields, options: mapping.options, savedMapping: input.saveAs?.trim() || null },
  });
  return mapping;
}
