import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, ScrollRegion } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { UploadForm } from "./upload-form";
import { formatNevadaDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Imports" };

const STATUS_TONE = { UPLOADED: "warn", QUEUED: "neutral", PROCESSING: "neutral", COMPLETED: "good", FAILED: "bad" } as const;

export default async function ImportsPage() {
  const operator = await requireOperator("case:read");
  const batches = await prisma.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, fileName: true, source: true, status: true, rowCount: true, insertedCount: true, duplicateCount: true,
      errorCount: true, reviewCount: true, newCaseCount: true, createdAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Imports</h1>
        <p className="max-w-3xl text-sm text-slate-600">
          Upload a Nevada unclaimed-property list (CSV or Excel) obtained through the Treasurer&apos;s official
          channels or a public-records request. You&apos;ll map its columns before anything is imported.
        </p>
      </div>
      {can(operator.role, "import:run") ? (
        <Card title="Upload a file">
          <UploadForm />
        </Card>
      ) : null}
      <Card title="Recent imports">
        {batches.length === 0 ? (
          <p className="text-sm text-slate-600">No imports yet.</p>
        ) : (
          <ScrollRegion label="Imports">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">File</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Status</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">Rows</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">New</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">Duplicates</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">Errors</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">To review</th>
                  <th scope="col" className="py-1 font-medium">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="py-1 pr-3">
                      <Link href={`/imports/${b.id}`} className="font-medium underline">
                        {b.fileName}
                      </Link>
                      <span className="block text-xs text-slate-500">{b.source}</span>
                    </td>
                    <td className="py-1 pr-3">
                      <Badge tone={STATUS_TONE[b.status]}>{b.status.toLowerCase()}</Badge>
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">{b.rowCount}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{b.insertedCount}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{b.duplicateCount}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{b.errorCount}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{b.reviewCount}</td>
                    <td className="py-1 whitespace-nowrap">{formatNevadaDate(b.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </Card>
    </div>
  );
}
