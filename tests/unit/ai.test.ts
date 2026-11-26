import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { costMicros, formatMicros } from "@/lib/ai/pricing";
import { loadPrompt, parsePrompt } from "@/lib/ai/prompts";
import { redactInput } from "@/lib/ai/run";

describe("AI cost tracking", () => {
  it("prices Opus 5.5 tokens including cache reads and writes", () => {
    const { micros } = costMicros(
      [{ model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 100 }],
      "claude-opus-5-5",
    );
    // 1000×4 + 500×20 + 2000×0.2 + 100×5 = 14,900 µ$ = $0.0149
    expect(micros).toBe(14_900);
    expect(formatMicros(micros)).toBe("$0.01");
    expect(formatMicros(1234)).toBe("$0.0012");
  });

  it("prices each fallback iteration at its own model's rate", () => {
    const { micros } = costMicros(
      [
        { model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        { model: "claude-opus-4-8", inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ],
      "claude-opus-5-5",
    );
    expect(micros).toBe(4000 + 5000 + 2500);
  });

  it("flags unknown models and charges mock runs nothing", () => {
    const r = costMicros([{ model: "claude-future-9", inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }], "claude-opus-5-5");
    expect(r.unknownModels).toEqual(["claude-future-9"]);
    expect(costMicros([{ model: "mock", inputTokens: 999, outputTokens: 999, cacheReadTokens: 0, cacheWriteTokens: 0 }], "claude-opus-5-5").micros).toBe(0);
  });
});

describe("versioned prompts", () => {
  it("every prompt in /prompts has a valid header matching its file name", () => {
    for (const f of readdirSync("prompts").filter((x) => x.endsWith(".md"))) {
      const p = parsePrompt(readFileSync(`prompts/${f}`, "utf8"));
      expect(p.name).toBe(f.replace(/\.md$/, ""));
      expect(p.version).toMatch(/^\d+$/);
      expect(p.system.length).toBeGreaterThan(100);
    }
    expect(loadPrompt("obituary-extraction").effort).toBe("low");
  });

  it("rejects path tricks and missing headers", () => {
    expect(() => loadPrompt("../package")).toThrow(/Invalid prompt name/);
    expect(() => parsePrompt("no header")).toThrow(/header/);
  });
});

describe("AI input redaction", () => {
  it("redacts SSN-like numbers anywhere in nested input", () => {
    expect(redactInput({ a: "SSN 123-45-6789", b: [{ c: "987654321" }], n: 5 })).toEqual({
      a: "SSN [REDACTED-SSN]",
      b: [{ c: "[REDACTED-SSN]" }],
      n: 5,
    });
  });
});
