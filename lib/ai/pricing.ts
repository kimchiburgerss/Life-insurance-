/**
 * USD per million tokens, Claude API first-party rates (cached 2026-11).
 * Cache writes use the 5-minute TTL rate (1.25 × input).
 * Update this table when Anthropic changes prices; unknown models are costed
 * at the requested model's rate and flagged.
 */
type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const MODEL_PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export type TokenUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Cost in millionths of a US dollar (integer). tokens × $/MTok = micro-dollars. */
export function costMicros(usages: TokenUsage[], fallbackModel: string): { micros: number; unknownModels: string[] } {
  let micros = 0;
  const unknownModels: string[] = [];
  for (const u of usages) {
    let price = MODEL_PRICES[u.model];
    if (!price) {
      if (u.model !== "mock") unknownModels.push(u.model);
      price = MODEL_PRICES[fallbackModel] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      if (u.model === "mock") price = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    }
    micros +=
      u.inputTokens * price.input +
      u.outputTokens * price.output +
      u.cacheReadTokens * price.cacheRead +
      u.cacheWriteTokens * price.cacheWrite;
  }
  return { micros: Math.round(micros), unknownModels };
}

export function formatMicros(micros: number): string {
  const usd = micros / 1_000_000;
  return usd < 0.01 && usd > 0 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
