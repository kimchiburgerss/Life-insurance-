import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { Prompt } from "./prompts";
import type { TokenUsage } from "./pricing";

/** Default model for every AI task. Override with AI_MODEL (e.g. a cheaper model) if you choose. */
export const DEFAULT_MODEL = "claude-opus-5-5";

export type ProviderResult = {
  /** Parsed JSON (already validated against the schema by the SDK when possible), or null. */
  parsed: unknown;
  rawText: string;
  servedBy: string;
  usages: TokenUsage[];
  stopReason: string | null;
  refusalCategory?: string | null;
};

export class AiRefusedError extends Error {
  constructor(readonly category: string | null) {
    super(`The model declined this request${category ? ` (${category})` : ""}.`);
    this.name = "AiRefusedError";
  }
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  // Credentials come from ANTHROPIC_API_KEY (or another credential source the SDK supports).
  client ??= new Anthropic({ maxRetries: 2, timeout: 120_000 });
  return client;
}

/**
 * One structured-output call to Claude.
 * - Output is constrained to the Zod schema (structured outputs) and parsed by the SDK.
 * - Server-side refusal fallbacks are on ("default" routing): if the model's
 *   safety classifier declines, the API retries on Anthropic's recommended
 *   fallback model within the same call.
 * - The system prompt is marked for prompt caching (it only caches once it is
 *   long enough; shorter prompts are silently not cached).
 */
export async function callClaude<S extends z.ZodType>(
  prompt: Prompt,
  schema: S,
  userContent: string,
  model = process.env.AI_MODEL || DEFAULT_MODEL,
): Promise<ProviderResult> {
  const response = await getClient().beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
    output_config: { effort: prompt.effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content: userContent }],
  });

  const u = response.usage;
  const usages: TokenUsage[] = u.iterations?.length
    ? u.iterations.map((it) => ({
        model: "model" in it && typeof it.model === "string" ? it.model : model,
        inputTokens: it.input_tokens ?? 0,
        outputTokens: it.output_tokens ?? 0,
        cacheReadTokens: ("cache_read_input_tokens" in it ? it.cache_read_input_tokens : 0) ?? 0,
        cacheWriteTokens: ("cache_creation_input_tokens" in it ? it.cache_creation_input_tokens : 0) ?? 0,
      }))
    : [
        {
          model,
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        },
      ];

  if (response.stop_reason === "refusal") {
    return {
      parsed: null,
      rawText: "",
      servedBy: response.model,
      usages,
      stopReason: "refusal",
      refusalCategory: response.stop_details?.category ?? null,
    };
  }
  const rawText = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { parsed: response.parsed_output ?? null, rawText, servedBy: response.model, usages, stopReason: response.stop_reason };
}
