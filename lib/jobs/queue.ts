/**
 * Background jobs on pg-boss (Postgres-backed — no Redis to run or pay for).
 * The worker runs inside the Next.js server process by default
 * (instrumentation.ts), so a single container is enough. Set RUN_JOBS=false
 * on extra web instances so only one process works the queues.
 */
import "server-only";
import { PgBoss } from "pg-boss";

export const QUEUES = {
  import: "import-process",
  /** Nightly: scores and eligibility depend on today's date. */
  rescore: "cases-rescore",
  /** Nightly: move cases out of the 24-month waiting period on their eligible date. */
  unlock: "waiting-period-unlock",
  /** Every 5 minutes: send approved messages that are due (and retry stuck ones). */
  outreachDispatch: "outreach-dispatch",
  /** Daily: draft day-21 / day-45 follow-ups (each still needs an approval). */
  followUps: "outreach-follow-ups",
  /** Daily: re-send unpaid online invoices at 7/14/30 days; flag unpaid manual ones. */
  invoiceReminders: "invoice-reminders",
  /** Nightly: purge contact details and documents past their retention period. */
  retention: "data-retention",
} as const;

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.boss) {
    globalForBoss.boss = (async () => {
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss" });
      boss.on("error", (e) => console.error("[jobs]", e));
      await boss.start();
      for (const name of Object.values(QUEUES)) await boss.createQueue(name);
      return boss;
    })().catch((e) => {
      globalForBoss.boss = undefined;
      throw e;
    });
  }
  return globalForBoss.boss;
}

export async function enqueueImport(batchId: string): Promise<void> {
  const boss = await getBoss();
  // singletonKey: queuing the same batch twice is a no-op.
  await boss.send(QUEUES.import, { batchId }, { singletonKey: batchId, retryLimit: 1, expireInSeconds: 60 * 60 });
  await ensureWorker();
}

/** Ask the worker to send due approved messages now (the 5-minute schedule is the backstop). */
export async function enqueueDispatch(): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.outreachDispatch, {}, { singletonKey: "dispatch-now", retryLimit: 0 });
  await ensureWorker();
}

/** Start this process's worker if it isn't running (no-op when already started). */
async function ensureWorker(): Promise<void> {
  if (process.env.RUN_JOBS === "false") return;
  const { startWorker } = await import("./worker");
  await startWorker();
}
