/**
 * Versioned prompts live in /prompts/<name>.md with a front-matter header:
 *   ---
 *   name: obituary-extraction
 *   version: 1
 *   effort: low
 *   description: ...
 *   ---
 *   <system prompt>
 * Bump `version` whenever the text changes; every AiRun records it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const Header = z.object({
  name: z.string(),
  version: z.coerce.string(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  description: z.string().optional(),
});

export type Prompt = z.infer<typeof Header> & { system: string };

const cache = new Map<string, Prompt>();

export function parsePrompt(source: string): Prompt {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source.replace(/\r\n/g, "\n"));
  if (!m) throw new Error("Prompt file is missing its --- header ---");
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { ...Header.parse(fields), system: m[2]!.trim() };
}

export function loadPrompt(name: string): Prompt {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Invalid prompt name "${name}"`);
  const hit = cache.get(name);
  if (hit && process.env.NODE_ENV === "production") return hit;
  const prompt = parsePrompt(readFileSync(path.join(process.cwd(), "prompts", `${name}.md`), "utf8"));
  if (prompt.name !== name) throw new Error(`Prompt file ${name}.md declares name "${prompt.name}"`);
  cache.set(name, prompt);
  return prompt;
}
