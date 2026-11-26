import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card } from "@/components/ui";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { IMPORT_FIELDS, ImportMappingSchema } from "@/lib/import/fields";
import { AutoRefresh } from "./auto-refresh";
import { MappingForm } from "./mapping-form";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage({ params }: PageProps<"/imports/[id]">) {
  const operator = await requireOperator("case:read");
  const { id } = await params;
  const batch = await prisma.importBatch.findUnique({
    where: { id },
    omit: { fileData: true },
  });
  if (!batch) notFound();
  const saved = await prisma.columnMapping.findMany({ orderBy: { lastUsedAt: "desc" }, select: { id: true, name: true, mapping: true } });
  const errors = (Array.isArray(batch.errors) ? batch.errors : []) as { row: number; error: string }[];
  const parsedMapping = ImportMappingSchema.safeParse(batch.columnMapping);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/imports" className="underline">
            Imports
          </Link>{" "}
          / {batch.fileName}
        </p>
        <h1 className="text-2xl font-semibold">{batch.fileName}</h1>
        <p className="text-sm text-slate-600">
          {batch.source} · {batch.rowCount} rows · uploaded {batch.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC ·{" "}
          <Badge>{batch.status.toLowerCase()}</Badge>
        </p>
      </div>

      {batch.status === "FAILED" ? <Alert>Import failed: {batch.failureMessage}. Fix the mapping and start it again.</Alert> : null}

      {(batch.status === "UPLOADED" || batch.status === "FAILED") && operator.role !== "VIEWER" ? (
        <MappingForm
          batchId={batch.id}
          headers={batch.headers}
          previewRows={batch.previewRows as Record<string, unknown>[]}
          initial={parsedMapping.success ? parsedMapping.data : { fields: (batch.columnMapping as { fields?: Record<string, string> })?.fields ?? {}, options: { nameOrder: "AUTO", dateOrder: "MDY" } }}
          fields={IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }))}
          saved={saved.map((s) => ({ id: s.id, name: s.name, mapping: s.mapping as never }))}
        />
      ) : null}

      {batch.status === "QUEUED" || batch.status === "PROCESSING" ? (
        <Card title="Importing…">
          <AutoRefresh seconds={2} />
          <p className="text-sm" role="status">
            The file is being normalized, de-duplicated and grouped in the background. This page refreshes on its own.
          </p>
        </Card>
      ) : null}

      {batch.status === "COMPLETED" ? (
        <Card title="Result">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            {[
              ["Rows read", batch.rowCount],
              ["New properties", batch.insertedCount],
              ["Duplicates skipped", batch.duplicateCount],
              ["Rows with errors", batch.errorCount],
              ["New owners", batch.newOwnerCount],
              ["Auto-grouped", batch.groupedCount],
              ["Need review", batch.reviewCount],
              ["New cases", batch.newCaseCount],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-slate-600">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 flex flex-wrap gap-4 text-sm">
            {batch.reviewCount > 0 ? (
              <Link href="/review" className="font-medium underline">
                Review {batch.reviewCount} possible duplicate owner{batch.reviewCount === 1 ? "" : "s"}
              </Link>
            ) : null}
            <Link href="/screening" className="font-medium underline">
              Go to the screening queue
            </Link>
          </p>
        </Card>
      ) : null}

      {errors.length > 0 ? (
        <Card title={`Rows that were skipped (${batch.errorCount})`}>
          <ul className="max-h-80 overflow-y-auto text-sm">
            {errors.map((e) => (
              <li key={`${e.row}-${e.error}`} className="border-t border-slate-100 py-1">
                Row {e.row}: {e.error}
              </li>
            ))}
          </ul>
          {batch.errorCount > errors.length ? <p className="mt-2 text-sm text-slate-600">First {errors.length} shown.</p> : null}
        </Card>
      ) : null}
    </div>
  );
}
