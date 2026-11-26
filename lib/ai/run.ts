/**
 * The single entry point for AI calls (build spec §6). Every call:
 *  1. loads a versioned prompt from /prompts,
 *  2. redacts SSN-like numbers from the input (only the fields the task needs
 *     are passed in by the caller),
 *  3. asks for structured output validated by Zod, retrying once with the
 *     validation error if the output is invalid,
 *  4. records an AiRun per attempt (prompt + version, model, input hash,
 *     redacted input, output, tokens, cost, linked case) with acceptance
 *     PENDING — the output is a SUGGESTION until a human accepts it.
 * In MOCK_MODE a deterministic local function stands in for the model.
 */
import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { redactSsnLike } from "@/lib/crypto/pii";
import { prisma, type DbClient } from "@/lib/db";
import { costMicros, type TokenUsage } from "./pricing";
import { loadPrompt } from "./prompts";
import { AiRefusedError, callClaude, DEFAULT_MODEL, type Attachment, type ProviderResult } from "./provider";

export class AiOutputError extends Error {}

export function aiMockMode(): boolean {
  return (process.env.MOCK_MODE ?? "true") !== "false";
}

/** Recursively redact SSN-like patterns in every string. */
export function redactInput<T>(value: T): T {
  if (typeof value === "string") return redactSsnLike(value) as T;
  if (Array.isArray(value)) return value.map(redactInput) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactInput(v)])) as T;
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export type RunOptions<S extends z.ZodType> = {
  promptName: string;
  schema: S;
  input: Record<string, unknown>;
  /** Deterministic stand-in used in MOCK_MODE (and by the mock eval baseline). */
  mock: (input: Record<string, unknown>) => z.infer<S>;
  caseId?: string | null;
  entityType?: string;
  entityId?: string;
  db?: DbClient;
  /**
   * Documents the model reads (e.g. an uploaded death certificate). Only their
   * type, size and SHA-256 are logged in the AiRun, never the content.
   */
  attachments?: Attachment[];
};

export type RunResult<T> = { runId: string; output: T; costMicros: number; model: string };

export async function runPrompt<S extends z.ZodType>(opts: RunOptions<S>): Promise<RunResult<z.infer<S>>> {
  const db = opts.db ?? prisma;
  const prompt = loadPrompt(opts.promptName);
  const attachmentLog = (opts.attachments ?? []).map((a) => ({
    kind: a.kind,
    mediaType: a.mediaType,
    bytes: Math.floor((a.base64.length * 3) / 4),
    sha256: createHash("sha256").update(a.base64).digest("hex"),
  }));
  const redacted = attachmentLog.length ? { ...redactInput(opts.input), attachments: attachmentLog } : redactInput(opts.input);
  const inputHash = createHash("sha256")
    .update(`${prompt.name}@${prompt.version}\n${stableStringify(redacted)}`)
    .digest("hex");
  const baseContent = `Input (JSON):\n${JSON.stringify(redactInput(opts.input), null, 2)}`;
  const requestedModel = aiMockMode() ? "mock" : process.env.AI_MODEL || DEFAULT_MODEL;

  const record = (
    status: "SUCCEEDED" | "INVALID_OUTPUT" | "FAILED",
    servedBy: string,
    usages: TokenUsage[],
    output: unknown,
    error?: string,
  ) => {
    const cost = costMicros(usages, requestedModel);
    return db.aiRun.create({
      data: {
        promptName: prompt.name,
        promptVersion: prompt.version,
        model: servedBy,
        inputHash,
        inputRedacted: redacted as never,
        output: (output ?? undefined) as never,
        status,
        error: error ? error.slice(0, 2000) : null,
        inputTokens: usages.reduce((s, u) => s + u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens, 0),
        outputTokens: usages.reduce((s, u) => s + u.outputTokens, 0),
        costMicros: cost.micros,
        caseId: opts.caseId ?? null,
        entityType: opts.entityType,
        entityId: opts.entityId,
        acceptance: status === "SUCCEEDED" ? "PENDING" : "NOT_APPLICABLE",
      },
    });
  };

  if (aiMockMode()) {
    const output = opts.schema.parse(opts.mock(redacted));
    const run = await record("SUCCEEDED", "mock", [], output);
    return { runId: run.id, output, costMicros: 0, model: "mock" };
  }

  let content = baseContent;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let result: ProviderResult;
    try {
      result = await callClaude(prompt, opts.schema, content, undefined, opts.attachments ?? []);
    } catch (e) {
      await record("FAILED", requestedModel, [], null, e instanceof Error ? e.message : String(e));
      throw e;
    }
    if (result.stopReason === "refusal") {
      await record("FAILED", result.servedBy, result.usages, null, `refusal: ${result.refusalCategory ?? "unspecified"}`);
      throw new AiRefusedError(result.refusalCategory ?? null);
    }
    const parsed = opts.schema.safeParse(result.parsed ?? safeJson(result.rawText));
    if (parsed.success) {
      const run = await record("SUCCEEDED", result.servedBy, result.usages, parsed.data);
      return { runId: run.id, output: parsed.data, costMicros: run.costMicros, model: result.servedBy };
    }
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    await record("INVALID_OUTPUT", result.servedBy, result.usages, { rawText: result.rawText.slice(0, 5000) }, issues);
    content = `${baseContent}\n\nYour previous answer did not match the required format (${issues}). Answer again using exactly the required format.`;
  }
  throw new AiOutputError("The AI output did not match the required format after a retry. Nothing was saved to the case.");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
