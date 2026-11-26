/**
 * Obituary fact extraction (build spec 5.3): the output schema, a deterministic
 * rule-based extractor (used in MOCK_MODE and as the eval baseline), and the
 * mapping from extracted relatives to heir candidates.
 */
import { z } from "zod";
import type { Relationship } from "@/lib/generated/prisma/enums";

export const EXTRACTED_RELATIONSHIPS = [
  "SPOUSE", "PARTNER", "CHILD", "STEP_CHILD", "GRANDCHILD", "GREAT_GRANDCHILD", "PARENT", "SIBLING",
  "NIECE_NEPHEW", "GRANDPARENT", "AUNT_UNCLE", "COUSIN", "IN_LAW", "FRIEND", "OTHER",
] as const;
export type ExtractedRelationship = (typeof EXTRACTED_RELATIONSHIPS)[number];

export const ObituaryExtraction = z.object({
  isObituary: z.boolean(),
  deceased: z.object({
    fullName: z.string(),
    otherNames: z.array(z.string()),
    age: z.number().int().nullable(),
    dateOfBirth: z.string().nullable().describe("YYYY-MM-DD, only if fully stated"),
    dateOfDeath: z.string().nullable().describe("YYYY-MM-DD, only if fully stated"),
    residenceCity: z.string().nullable(),
    residenceState: z.string().nullable(),
  }),
  relatives: z.array(
    z.object({
      name: z.string(),
      relationship: z.enum(EXTRACTED_RELATIONSHIPS),
      status: z.enum(["SURVIVING", "PREDECEASED", "UNKNOWN"]),
      throughRelativeName: z.string().nullable(),
      city: z.string().nullable(),
      evidenceQuote: z.string(),
    }),
  ),
  notes: z.string().nullable(),
});
export type ObituaryExtraction = z.infer<typeof ObituaryExtraction>;

/** Map to the Person.relationship enum (in-laws, step-children, partners are not intestate heirs → OTHER). */
export function toPersonRelationship(r: ExtractedRelationship): Relationship {
  switch (r) {
    case "SPOUSE":
    case "CHILD":
    case "GRANDCHILD":
    case "PARENT":
    case "SIBLING":
    case "NIECE_NEPHEW":
    case "GRANDPARENT":
    case "AUNT_UNCLE":
    case "COUSIN":
      return r;
    case "GREAT_GRANDCHILD":
      return "GRANDCHILD";
    default:
      return "OTHER";
  }
}

/** Starting confidence that a named relative is who the obituary says (human review adjusts it). */
export function initialConfidence(r: ObituaryExtraction["relatives"][number], quoteFound: boolean): number {
  const base: Partial<Record<ExtractedRelationship, number>> = {
    SPOUSE: 0.8, CHILD: 0.8, PARENT: 0.75, SIBLING: 0.75, GRANDCHILD: 0.65, NIECE_NEPHEW: 0.6,
  };
  const c = (base[r.relationship] ?? 0.4) - (quoteFound ? 0 : 0.3);
  return Math.round(Math.max(0.1, c) * 100) / 100;
}

/** True when the evidence quote really occurs in the obituary (guards against invented relatives). */
export function quoteAppears(quote: string, text: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const q = norm(quote);
  return q.length > 0 && norm(text).includes(q);
}

// ─── Rule-based extractor (mock / baseline) ─────────────────────────────────

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07",
  august: "08", september: "09", october: "10", november: "11", december: "12",
};
const STATES: Record<string, string> = { nevada: "NV", california: "CA", arizona: "AZ", utah: "UT", oregon: "OR", idaho: "ID" };
const DATE = /(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})|(\d{4})-(\d{2})-(\d{2})/;

function toIso(m: RegExpExecArray | null): string | null {
  if (!m) return null;
  if (m[4]) return `${m[4]}-${m[5]}-${m[6]}`;
  return `${m[3]}-${MONTHS[m[1]!.toLowerCase()]}-${m[2]!.padStart(2, "0")}`;
}

const KEYWORDS: [RegExp, ExtractedRelationship][] = [
  [/\b(great[- ]grandchildren|great[- ]grandsons?|great[- ]granddaughters?|great[- ]grandchild)\b/i, "GREAT_GRANDCHILD"],
  [/\b(grandchildren|grandsons?|granddaughters?|grandchild)\b/i, "GRANDCHILD"],
  [/\b(grandparents|grandmother|grandfather)\b/i, "GRANDPARENT"],
  [/\b(sons?-in-law|daughters?-in-law|brothers?-in-law|sisters?-in-law|in-laws?)\b/i, "IN_LAW"],
  [/\b(stepsons?|stepdaughters?|stepchildren|step-children)\b/i, "STEP_CHILD"],
  [/\b(wife|husband|spouse)\b/i, "SPOUSE"],
  [/\b(partner|companion|fianc[eé]e?)\b/i, "PARTNER"],
  [/\b(children|sons?|daughters?|child)\b/i, "CHILD"],
  [/\b(parents|mother|father)\b/i, "PARENT"],
  [/\b(brothers?|sisters?|siblings?)\b/i, "SIBLING"],
  [/\b(nieces?|nephews?)\b/i, "NIECE_NEPHEW"],
  [/\b(aunts?|uncles?)\b/i, "AUNT_UNCLE"],
  [/\b(cousins?)\b/i, "COUSIN"],
];

// A middle initial may be written with or without a period ("Harold P. Winslow" / "Harold P Winslow").
const NAME = /\b([A-Z][a-zA-Z'’.-]+(?: (?:[A-Z]\.?(?![a-zA-Z])|[A-Z][a-zA-Z'’-]+)){0,3}(?: \([A-Z][a-zA-Z'’-]+\))?(?: [A-Z][a-zA-Z'’-]+)?)/g;
const NOT_NAMES = new Set(["His", "Her", "Their", "The", "And", "He", "She", "Survived", "Preceded", "Predeceased", "Also", "In", "Many", "Several", "Numerous", "Las", "Vegas", "Reno", "Nevada"]);

function namesIn(fragment: string): string[] {
  const cleaned = fragment
    .replace(/\((?:[^)]*\b(?:of|in)\b[^)]*)\)/g, " ") // "(of Reno)" location notes
    .replace(/\b(?:of|in) [A-Z][a-z]+(?: [A-Z][a-z]+)?(?:,? [A-Z]{2}| Nevada| California| Arizona)?/g, " ");
  return [...cleaned.matchAll(NAME)]
    .map((m) => m[1]!.replace(/\.$/, "").trim())
    .filter((n) => !NOT_NAMES.has(n.split(" ")[0]!) && n.length > 1);
}

function splitSegments(clause: string): string[] {
  return clause.split(/;|, and (?=(?:his|her|their)?\s*(?:[a-z-]+ )?(?:wife|husband|spouse|partner|children|sons?|daughters?|grand|great|parents|mother|father|brothers?|sisters?|siblings?|nieces?|nephews?|aunts?|uncles?|cousins?|step))/i);
}

function relativesFromClause(clause: string, status: "SURVIVING" | "PREDECEASED"): ObituaryExtraction["relatives"] {
  const out: ObituaryExtraction["relatives"] = [];
  let current: ExtractedRelationship | null = null;
  for (const raw of splitSegments(clause)) {
    const seg = raw.trim();
    if (!seg) continue;
    const kw = KEYWORDS.find(([re]) => re.test(seg));
    if (kw) current = kw[1];
    if (!current) continue;
    const afterKeyword = kw ? seg.slice(seg.search(kw[0]) + (seg.match(kw[0])?.[0].length ?? 0)) : seg;
    for (const name of namesIn(afterKeyword)) {
      out.push({ name, relationship: current, status, throughRelativeName: null, city: null, evidenceQuote: seg.slice(0, 200) });
    }
  }
  return out;
}

export function extractObituaryHeuristic(text: string): ObituaryExtraction {
  const t = text.replace(/\s+/g, " ").trim();
  const isObituary = /\b(passed away|died|obituary|survived by|preceded in death|predeceased|went to be with|entered into rest)\b/i.test(t);
  const first = /^([A-Z][a-zA-Z'’.-]+(?: (?:[A-Z]\.?(?![a-zA-Z])|"[A-Za-z]+"|\([A-Z][a-zA-Z'’-]+\)|[A-Z][a-zA-Z'’-]+)){1,4})/.exec(t);
  const fullName = first ? first[1]!.replace(/\s*"[^"]+"/, "").replace(/\s*\([^)]+\)/, "").trim() : "";
  const otherNames = [
    ...(first?.[1]?.match(/"([^"]+)"/)?.slice(1) ?? []),
    ...(first?.[1]?.match(/\(([^)]+)\)/)?.slice(1) ?? []),
  ];
  const age = /,\s*(\d{2,3}),/.exec(t.slice(0, 200));
  const deathSentence = /(passed away|died|went to be with the Lord|entered into rest)[^.]*?(?:on )?((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})/i.exec(t);
  const born = /\bborn\b[^.]*?((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4})/i.exec(t);
  const residence = /\bof ([A-Z][a-z]+(?: [A-Z][a-z]+)?),? (Nevada|California|Arizona|Utah|Oregon|Idaho|NV|CA|AZ|UT)\b/.exec(t);

  const survived = /\bsurvived by ([^.]+)\./i.exec(t);
  const preceded = /\b(?:preceded|predeceased) in death by ([^.]+)\.|\bpredeceased by ([^.]+)\./i.exec(t);
  const relatives = [
    ...(preceded ? relativesFromClause(preceded[1] ?? preceded[2] ?? "", "PREDECEASED") : []),
    ...(survived ? relativesFromClause(survived[1]!, "SURVIVING") : []),
  ];
  const deceasedFirst = fullName.split(" ")[0];
  const seen = new Set<string>();
  const unique = relatives.filter((r) => {
    const key = `${r.name}|${r.relationship}`;
    if (seen.has(key) || r.name === fullName || r.name === deceasedFirst) return false;
    seen.add(key);
    return true;
  });

  return {
    isObituary,
    deceased: {
      fullName,
      otherNames,
      age: age ? Number(age[1]) : null,
      dateOfBirth: born ? toIso(DATE.exec(born[1]!)) : null,
      dateOfDeath: deathSentence ? toIso(DATE.exec(deathSentence[2]!)) : null,
      residenceCity: residence ? residence[1]! : null,
      residenceState: residence ? (STATES[residence[2]!.toLowerCase()] ?? residence[2]!) : null,
    },
    relatives: isObituary ? unique : [],
    notes: "Extracted by the rule-based baseline (mock mode).",
  };
}
