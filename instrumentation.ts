/**
 * Next.js calls register() once when the server starts. In production we start
 * the background-job worker here (Node.js runtime only) unless RUN_JOBS=false,
 * so queued jobs resume after a restart.
 *
 * In development the worker is NOT started here: loading the app's module
 * graph from instrumentation makes the dev server's hot reload loop forever.
 * Instead the worker starts on the first enqueue (lib/jobs/queue.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.RUN_JOBS === "false" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWorker } = await import("./lib/jobs/worker");
  await startWorker().catch((e) => console.error("[jobs] failed to start worker", e));
}
