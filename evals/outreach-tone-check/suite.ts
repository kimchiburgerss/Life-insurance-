/**
 * Outreach tone-check eval (14 fictional paragraphs: 6 that should pass, 8 that
 * must be fixed — pressure, government look-alike, exaggeration, cheerful
 * sales tone, legalese, sensitive-data requests, outbound calls/texts).
 *
 *   npm run evals                → scores the rule-based baseline (free, no API calls)
 *   EVAL_LIVE=1 npm run evals    → scores Claude with the current prompt (costs money;
 *                                   needs ANTHROPIC_API_KEY). Prints the total cost.
 *
 * Thresholds: live ≥ 90% of cases, baseline ≥ 70%.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadPrompt } from "../../lib/ai/prompts";
import { costMicros, formatMicros } from "../../lib/ai/pricing";
import { mockToneCheck, tonePassed, ToneCheckOutput } from "../../lib/outreach/ai";
import { privateCompanyStatement } from "../../lib/outreach/content";

type Case = { id: string; text: string; expected: "PASS" | "NEEDS_CHANGES" };

const REQUIRED = [
  "You can claim this property yourself, for free, directly from the Nevada State Treasurer's Office, Unclaimed Property Division at https://claims.nevadaunclaimedproperty.gov. You do not need to use our service or pay anyone to file a claim.",
  privateCompanyStatement("NV"),
];

export async function run() {
  const { cases } = JSON.parse(readFileSync(path.join(process.cwd(), "evals/outreach-tone-check/cases.json"), "utf8")) as { cases: Case[] };
  const live = process.env.EVAL_LIVE === "1";
  const prompt = loadPrompt("outreach-tone-check");
  let passed = 0;
  let totalMicros = 0;
  for (const c of cases) {
    const input = { channel: "MAIL" as const, subject: null, text: c.text, requiredStatements: REQUIRED };
    let out: ToneCheckOutput;
    if (live) {
      const { callClaude } = await import("../../lib/ai/provider");
      const r = await callClaude(prompt, ToneCheckOutput, `Input (JSON):\n${JSON.stringify(input, null, 2)}`);
      totalMicros += costMicros(r.usages, "claude-opus-5-5").micros;
      out = ToneCheckOutput.parse(r.parsed);
    } else {
      out = mockToneCheck(input);
    }
    const got = tonePassed(out) ? "PASS" : "NEEDS_CHANGES";
    const ok = got === c.expected;
    if (ok) passed++;
    console.log(`  ${ok ? "✓" : "✗"} ${c.id.padEnd(28)} expected ${c.expected.padEnd(13)} got ${got}`);
  }
  if (live) console.log(`  prompt ${prompt.name}@${prompt.version} · cost ${formatMicros(totalMicros)}`);
  return {
    name: `outreach-tone-check (${live ? `live, ${prompt.name}@${prompt.version}` : "rule-based baseline"})`,
    passed,
    total: cases.length,
    minPassRate: live ? 0.9 : 0.7,
  };
}
