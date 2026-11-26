/**
 * Parse uploaded CSV / TSV / XLSX files into header + row objects.
 * Files come from the Treasurer through official channels (no scraping).
 */
import Papa from "papaparse";
import { readSheet } from "read-excel-file/node";

export const MAX_UPLOAD_BYTES = Number(process.env.IMPORT_MAX_MB ?? 50) * 1024 * 1024;
export const MAX_ROWS = 500_000;

export type FileType = "csv" | "xlsx";
export type ParsedFile = { headers: string[]; rows: Record<string, unknown>[] };

export class ImportFileError extends Error {}

export function detectFileType(fileName: string): FileType {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "txt" || ext === "tsv") return "csv";
  if (ext === "xlsx") return "xlsx";
  if (ext === "xls") throw new ImportFileError("Old .xls files aren't supported. Save the file as .xlsx or .csv and upload again.");
  throw new ImportFileError("Upload a .csv, .tsv, .txt or .xlsx file.");
}

function dedupeHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = String(h ?? "").trim() || `Column ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
}

function toRows(headers: string[], data: unknown[][]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of data) {
    if (line.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      row[h] = line[i] ?? null;
    });
    rows.push(row);
  }
  return rows;
}

export async function parseImportFile(data: Uint8Array, fileType: FileType): Promise<ParsedFile> {
  if (data.byteLength > MAX_UPLOAD_BYTES) {
    throw new ImportFileError(`File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  let matrix: unknown[][];
  if (fileType === "csv") {
    const text = new TextDecoder("utf-8").decode(data).replace(/^﻿/, "");
    const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", dynamicTyping: false });
    if (result.errors.length && result.data.length === 0) {
      throw new ImportFileError(`Could not read the CSV: ${result.errors[0]!.message}`);
    }
    matrix = result.data;
  } else {
    try {
      // First worksheet only; date-formatted cells come back as Date objects.
      matrix = (await readSheet(Buffer.from(data))) as unknown[][];
    } catch (e) {
      throw new ImportFileError(`Could not read the Excel file: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }
  if (matrix.length < 2) throw new ImportFileError("The file needs a header row and at least one data row.");
  if (matrix.length - 1 > MAX_ROWS) throw new ImportFileError(`The file has more than ${MAX_ROWS.toLocaleString()} rows. Split it and upload the parts.`);
  const headers = dedupeHeaders(matrix[0]!);
  return { headers, rows: toRows(headers, matrix.slice(1)) };
}
