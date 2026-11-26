/**
 * Outreach templates live in /templates/outreach/*.md (Markdown + {{variables}})
 * with a front-matter header:
 *   ---
 *   id: letter-first
 *   version: 1
 *   channel: MAIL | EMAIL | INSERT
 *   step: 1            (1 = first contact, 2 = day-21 follow-up, 3 = day-45)
 *   title: First letter
 *   subject: ...       (emails only; may use variables)
 *   includesFaqInsert: true
 *   ---
 * Bump `version` whenever the wording changes: approvals, counsel sign-off and
 * response-rate metrics are all recorded per template version.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const TEMPLATE_DIR = path.join(process.cwd(), "templates", "outreach");

const Header = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  version: z.coerce.string(),
  channel: z.enum(["MAIL", "EMAIL", "INSERT"]),
  step: z.coerce.number().int().min(1).max(3).optional(),
  title: z.string().min(1),
  subject: z.string().optional(),
  includesFaqInsert: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type OutreachTemplate = z.infer<typeof Header> & { body: string };

/** Every variable a template may use. Values are escaped by the renderer. */
export const TEMPLATE_VARIABLES = [
  "heirName",
  "ownerName",
  "personalNote",
  "propertySummary",
  "amountSentence",
  "feeSentence",
  "disclosure",
  "privateCompany",
  "claimWebsite",
  "contactName",
  "contactTitleLine",
  "businessName",
  "businessPhone",
  "businessEmail",
  "caseRef",
  "optOutUrl",
  "portalUrl",
  "firstLetterDate",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/**
 * Spec 5.6: every template must include who we are, how we found them (public
 * records), what the property is, the free-claim option with the website, our
 * fee, and how to reach a real person — plus (rule 5) the private-company line.
 */
export const REQUIRED_ELEMENTS: { key: string; label: string; test: (t: OutreachTemplate) => boolean }[] = [
  { key: "who", label: "Who we are (business and contact person)", test: (t) => has(t, "businessName") && has(t, "contactName") },
  { key: "public_records", label: "How we found them (public records)", test: (t) => /public records/i.test(t.body) },
  { key: "property", label: "What the property is", test: (t) => has(t, "propertySummary") && has(t, "amountSentence") },
  { key: "free_claim", label: "Free claim directly from the State, with website", test: (t) => has(t, "disclosure") },
  { key: "fee", label: "Our fee", test: (t) => has(t, "feeSentence") },
  { key: "real_person", label: "How to reach a real person", test: (t) => has(t, "businessPhone") },
  { key: "private_company", label: "Not part of or endorsed by the government", test: (t) => has(t, "privateCompany") },
  { key: "reference", label: "Case reference for replies", test: (t) => has(t, "caseRef") },
];

function has(t: OutreachTemplate, variable: TemplateVariable): boolean {
  return t.body.includes(`{{${variable}}}`);
}

export function variablesUsed(source: string): string[] {
  return [...new Set([...source.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]!))];
}

export function parseTemplate(source: string): OutreachTemplate {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source.replace(/\r\n/g, "\n"));
  if (!m) throw new Error("Template is missing its --- header ---");
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return { ...Header.parse(fields), body: m[2]!.trim() };
}

/** Problems that make a template unusable. Empty = valid. */
export function validateTemplate(t: OutreachTemplate): string[] {
  const problems: string[] = [];
  const known = new Set<string>(TEMPLATE_VARIABLES);
  for (const v of variablesUsed(`${t.subject ?? ""}\n${t.body}`)) {
    if (!known.has(v)) problems.push(`Unknown variable {{${v}}}`);
  }
  if (t.channel === "INSERT") return problems;
  if (!t.step) problems.push("Missing step");
  if (t.channel === "EMAIL" && !t.subject) problems.push("Email templates need a subject");
  for (const el of REQUIRED_ELEMENTS) if (!el.test(t)) problems.push(`Missing required element: ${el.label}`);
  return problems;
}

let cache: OutreachTemplate[] | null = null;

export function loadTemplates(): OutreachTemplate[] {
  if (cache && process.env.NODE_ENV === "production") return cache;
  const templates = readdirSync(TEMPLATE_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const t = parseTemplate(readFileSync(path.join(TEMPLATE_DIR, f), "utf8"));
      if (`${t.id}.md` !== f) throw new Error(`Template ${f} declares id "${t.id}"`);
      const problems = validateTemplate(t);
      if (problems.length) throw new Error(`Template ${f} is invalid: ${problems.join("; ")}`);
      return t;
    });
  cache = templates;
  return templates;
}

export function getTemplate(id: string): OutreachTemplate {
  const t = loadTemplates().find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template "${id}"`);
  return t;
}

/** The template for a channel and sequence step (1 = first contact). */
export function templateFor(channel: "MAIL" | "EMAIL", step: number): OutreachTemplate {
  const t = loadTemplates().find((x) => x.channel === channel && x.step === step);
  if (!t) throw new Error(`No ${channel} template for step ${step}`);
  return t;
}

export const FAQ_INSERT_ID = "insert-public-records-faq";

/** Message templates (not inserts) with their versions, for counsel sign-off. */
export function currentTemplateVersions(): Record<string, string> {
  return Object.fromEntries(loadTemplates().map((t) => [t.id, t.version]));
}
