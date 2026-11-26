import "server-only";
import { prisma } from "@/lib/db";
import { processImportBatch } from "@/lib/import/process";
import { rescoreOpenCases } from "@/lib/screening/maintenance";
import { getBoss, QUEUES } from "./queue";

const globalForWorker = globalThis as unknown as { workerStarted?: boolean };

/** Register job handlers once per process. */
export async function startWorker(): Promise<void> {
  if (globalForWorker.workerStarted) return;
  globalForWorker.workerStarted = true;
  const boss = await getBoss();
  await boss.work<{ batchId: string }>(QUEUES.import, async (jobs) => {
    for (const job of jobs) {
      await processImportBatch(job.data.batchId);
    }
  });
  await boss.work(QUEUES.rescore, async () => {
    const n = await rescoreOpenCases(prisma);
    console.log(`[jobs] rescored ${n} open cases`);
  });
  // 02:41 in Nevada every night.
  await boss.schedule(QUEUES.rescore, "41 2 * * *", null, { tz: "America/Los_Angeles" });
  console.log("[jobs] worker started");
}
