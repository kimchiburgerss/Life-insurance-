/**
 * `npm run evals` — runs every AI evaluation suite in /evals.
 *
 * A suite is a folder `evals/<name>/` containing `cases.json` (inputs +
 * expected outputs) and `suite.ts` exporting `run(): Promise<EvalResult>`.
 * Suites arrive with the AI features (Phase 3: obituary extraction). With no
 * suites present this exits 0 so CI stays green.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type EvalResult = { name: string; passed: number; total: number; minPassRate: number };

async function main() {
  const root = join(process.cwd(), "evals");
  const suites = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "suite.ts")))
        .map((d) => d.name)
    : [];
  if (suites.length === 0) {
    console.log("No eval suites yet (they arrive with the AI features in Phase 3).");
    return;
  }
  let failed = false;
  for (const name of suites) {
    const mod = (await import(pathToFileURL(join(root, name, "suite.ts")).href)) as { run: () => Promise<EvalResult> };
    const r = await mod.run();
    const rate = r.total === 0 ? 1 : r.passed / r.total;
    const ok = rate >= r.minPassRate;
    failed ||= !ok;
    console.log(`${ok ? "✓" : "✗"} ${r.name}: ${r.passed}/${r.total} (min ${(r.minPassRate * 100).toFixed(0)}%)`);
  }
  if (failed) process.exitCode = 1;
}

void main();
