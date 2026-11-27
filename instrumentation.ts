/**
 * Next.js calls register() once when the server starts. In production we make
 * sure this version's jurisdiction rules exist, then start the background-job
 * worker (Node.js runtime only) unless RUN_JOBS=false, so queued jobs resume
 * after a restart.
 *
 * In development the worker is NOT started here: loading the app's module
 * graph from instrumentation makes the dev server's hot reload loop forever.
 * Instead the worker starts on the first enqueue (lib/jobs/queue.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.RUN_JOBS === "false" || process.env.NEXT_PHASE === "phase-production-build") return;
  // Rules shipped with this version (never overwrites one you edited or verified).
  const { ensureJurisdictionRules } = await import("./lib/rules/seed");
  await ensureJurisdictionRules().catch((e) => console.error("[rules] could not ensure jurisdiction rules", e));
  const { startWorker } = await import("./lib/jobs/worker");
  await startWorker().catch((e) => console.error("[jobs] failed to start worker", e));
}
