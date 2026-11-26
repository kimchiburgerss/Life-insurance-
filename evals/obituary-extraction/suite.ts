/**
 * Obituary-extraction eval (20 fictional obituaries).
 *
 *   npm run evals                       → scores the rule-based baseline (free, no API calls)
 *   EVAL_LIVE=1 npm run evals           → scores Claude with the current prompt (costs money;
 *                                          needs ANTHROPIC_API_KEY). Prints the total cost.
 *
 * A case passes at score ≥ 0.8. Thresholds: live ≥ 90% of cases, baseline ≥ 50%.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadPrompt } from "../../lib/ai/prompts";
import { costMicros, formatMicros } from "../../lib/ai/pricing";
import { extractObituaryHeuristic, ObituaryExtraction } from "../../lib/research/obituary";
import { scoreCase, type Expected } from "./score";

type Case = { id: string; text: string; expected: Expected };

export async function run() {
  const { cases } = JSON.parse(readFileSync(path.join(process.cwd(), "evals/obituary-extraction/cases.json"), "utf8")) as {
    cases: Case[];
  };
  const live = process.env.EVAL_LIVE === "1";
  const prompt = loadPrompt("obituary-extraction");
  let passed = 0;
  let totalMicros = 0;
  for (const c of cases) {
    let predicted: ObituaryExtraction;
    if (live) {
      const { callClaude } = await import("../../lib/ai/provider");
      const r = await callClaude(prompt, ObituaryExtraction, `Input (JSON):\n${JSON.stringify({ obituaryText: c.text }, null, 2)}`);
      totalMicros += costMicros(r.usages, "claude-opus-5-5").micros;
      predicted = ObituaryExtraction.parse(r.parsed);
    } else {
      predicted = extractObituaryHeuristic(c.text);
    }
    const s = scoreCase(c.expected, predicted);
    if (s.score >= 0.8) passed++;
    console.log(`  ${s.score >= 0.8 ? "✓" : "✗"} ${c.id.padEnd(26)} ${s.score.toFixed(2)}  ${s.details}`);
  }
  if (live) console.log(`  prompt ${prompt.name}@${prompt.version} · cost ${formatMicros(totalMicros)}`);
  return {
    name: `obituary-extraction (${live ? `live, ${prompt.name}@${prompt.version}` : "rule-based baseline"})`,
    passed,
    total: cases.length,
    minPassRate: live ? 0.9 : 0.5,
  };
}
