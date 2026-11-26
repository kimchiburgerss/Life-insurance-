"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { todayIn } from "@/lib/dates";
import { ImportMappingSchema, type ImportMapping } from "@/lib/import/fields";
import { parseImportFile, type FileType } from "@/lib/import/parse";
import { normalizeRow } from "@/lib/import/row";
import { confirmImportMapping } from "@/lib/import/upload";
import { enqueueImport } from "@/lib/jobs/queue";

export type PreviewRow = {
  row: number;
  ok: boolean;
  error?: string;
  propertyId?: string;
  owner?: string;
  flags?: string[];
  address?: string | null;
  category?: string;
  amount?: string;
  delivered?: string;
};

export type MappingState = {
  error?: string;
  preview?: PreviewRow[];
  previewErrors?: number;
  previewTotal?: number;
};

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? fallback;
  return e instanceof Error ? e.message : fallback;
}

function readMapping(formData: FormData): ImportMapping {
  const fields: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("field:") && typeof v === "string" && v) fields[k.slice(6)] = v;
  }
  return ImportMappingSchema.parse({
    fields,
    options: { nameOrder: formData.get("nameOrder") ?? "AUTO", dateOrder: formData.get("dateOrder") ?? "MDY" },
  });
}

/** Preview the first 25 rows as they will be imported (nothing is saved). */
export async function previewMapping(_: MappingState, formData: FormData): Promise<MappingState> {
  await requireOperator("import:run");
  let mapping: ImportMapping;
  try {
    mapping = readMapping(formData);
  } catch (e) {
    return { error: errorMessage(e, "Invalid mapping.") };
  }
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: String(formData.get("batchId")) },
    select: { fileData: true, fileType: true, stateCode: true },
  });
  if (!batch.fileData) return { error: "The uploaded file is no longer stored." };
  const { rows } = await parseImportFile(batch.fileData, batch.fileType as FileType);
  const today = todayIn();
  const results = rows.map((r, i) => normalizeRow(r, mapping, i + 2, batch.stateCode, today));
  const preview: PreviewRow[] = results.slice(0, 25).map((r) =>
    r.ok
      ? {
          row: r.record.rowNumber,
          ok: true,
          propertyId: r.record.statePropertyId,
          owner: r.record.name.full || r.record.ownerNameRaw,
          flags: r.record.flags,
          address: r.record.address?.formatted ?? null,
          category: r.record.category,
          amount: r.record.amountCents === null ? "not disclosed" : `${r.record.amountIsMinimum ? "≥ " : ""}$${(r.record.amountCents / 100).toFixed(2)}`,
          delivered: r.record.delivered
            ? `${r.record.delivered.date.toISOString().slice(0, 10)}${r.record.delivered.precision !== "DAY" ? ` (${r.record.delivered.precision.toLowerCase()} only)` : ""}`
            : "missing",
        }
      : { row: r.rowNumber, ok: false, error: r.error },
  );
  return { preview, previewErrors: results.filter((r) => !r.ok).length, previewTotal: results.length };
}

/** Save the mapping and queue the background import. */
export async function startImport(_: MappingState, formData: FormData): Promise<MappingState> {
  const operator = await requireOperator("import:run");
  const batchId = String(formData.get("batchId"));
  try {
    const mapping = readMapping(formData);
    if (mapping.fields.dateDeliveredToState && /report/i.test(mapping.fields.dateDeliveredToState) && formData.get("confirmReportDate") !== "on") {
      return { error: "Confirm that the report-date column reflects when the property was delivered to the state (see the note below the mapping)." };
    }
    await confirmImportMapping({ batchId, mapping, saveAs: String(formData.get("saveAs") ?? ""), actorId: operator.id });
    await enqueueImport(batchId);
  } catch (e) {
    return { error: errorMessage(e, "Could not start the import.") };
  }
  revalidatePath(`/imports/${batchId}`);
  revalidatePath("/imports");
  return {};
}
