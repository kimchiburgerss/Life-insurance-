/**
 * AI document review (spec 5.8): Claude reads one uploaded document and
 * reports type, legibility, names, dates and problems; the app then compares
 * names and dates with the case. The result is a SUGGESTION (AiRun, pending
 * until a human accepts or dismisses it) — it never changes a document's
 * status by itself. Only the operator starts a review, per document.
 */
import "server-only";
import { z } from "zod";
import { runPrompt } from "@/lib/ai/run";
import { prisma } from "@/lib/db";
import { formatDateOnly } from "@/lib/dates";
import { readFile } from "@/lib/files/storage";
import { scoreOwnerMatch } from "@/lib/match/owner";
import { parseOwnerName } from "@/lib/normalize/name";
import { writeAudit } from "@/lib/audit";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import type { Role } from "@/lib/generated/prisma/enums";
import { getActiveRule } from "@/lib/rules/repository";
import { todayIn } from "@/lib/dates";

export class ReviewError extends Error {}

export const DocumentReview = z.object({
  documentType: z.string(),
  matchesExpectedType: z.boolean(),
  legible: z.boolean(),
  namesFound: z.array(z.object({ name: z.string(), role: z.string() })).max(30),
  datesFound: z.array(z.object({ date: z.string().nullable(), what: z.string() })).max(30),
  signedAndNotarized: z.boolean().nullable(),
  issues: z.array(z.object({ severity: z.enum(["high", "medium", "low"]), message: z.string() })).max(20),
  summary: z.string(),
});
export type DocumentReview = z.infer<typeof DocumentReview>;

/** 0–1 similarity of two personal names, tolerant of order ("LAST, FIRST") and middle initials. */
export function nameSimilarity(a: string, b: string): number {
  const x = parseOwnerName(a, "AUTO");
  const y = parseOwnerName(b, "AUTO");
  if (!x.tokens.length || !y.tokens.length) return 0;
  return scoreOwnerMatch({ tokens: x.tokens, suffix: x.suffix, address: null }, { tokens: y.tokens, suffix: y.suffix, address: null }).score;
}

export type ConsistencyFlag = { severity: "high" | "medium" | "low"; message: string };

const DECEASED_ROLES = /decedent|deceased|died|owner|name of deceased/i;
const DEATH_DATE = /death|died|deceased/i;

/** Compare what the document shows with the case (pure). */
export function consistencyFlags(review: DocumentReview, facts: { ownerName: string; ownerDateOfDeath: string | null; claimantName: string; checklistKey: string }): ConsistencyFlag[] {
  const flags: ConsistencyFlag[] = [];
  if (!review.matchesExpectedType) flags.push({ severity: "high", message: `This looks like "${review.documentType}", not the document this item needs.` });
  if (!review.legible) flags.push({ severity: "high", message: "Parts of the document are not readable — ask for a clearer copy." });
  if (facts.checklistKey === "death_certificate") {
    const deceased = review.namesFound.filter((n) => DECEASED_ROLES.test(n.role));
    const best = Math.max(0, ...deceased.map((n) => nameSimilarity(n.name, facts.ownerName)));
    if (deceased.length === 0) flags.push({ severity: "medium", message: "No decedent name was found on the certificate." });
    else if (best < 0.85) flags.push({ severity: "high", message: `Decedent name "${deceased[0]!.name}" does not match the owner "${facts.ownerName}".` });
    const deathDates = review.datesFound.filter((d) => DEATH_DATE.test(d.what) && d.date);
    if (facts.ownerDateOfDeath && deathDates.length && !deathDates.some((d) => d.date === facts.ownerDateOfDeath)) {
      flags.push({ severity: "high", message: `Date of death ${deathDates[0]!.date} differs from the case (${facts.ownerDateOfDeath}).` });
    }
  }
  if (facts.checklistKey === "claimant_id") {
    const best = Math.max(0, ...review.namesFound.map((n) => nameSimilarity(n.name, facts.claimantName)));
    if (best < 0.85) flags.push({ severity: "high", message: `The ID does not show the claimant's name (${facts.claimantName}).` });
  }
  if (["small_estate_affidavit", "spouse_small_estate_affidavit", "affidavit_of_heirship", "release_of_heir"].includes(facts.checklistKey) && review.signedAndNotarized === false) {
    flags.push({ severity: "high", message: "This affidavit must be signed and notarized." });
  }
  return flags;
}

/** Demo stand-in: never pretends to have read the document. */
export function mockDocumentReview(input: Record<string, unknown>): DocumentReview {
  const i = input as { expected: { label: string }; file: { contentType: string } };
  return {
    documentType: `(demo) ${i.expected.label}`,
    matchesExpectedType: true,
    legible: true,
    namesFound: [],
    datesFound: [],
    signedAndNotarized: null,
    issues: [{ severity: "low", message: "Demo mode: the document was not actually read. Check it yourself before accepting it." }],
    summary: `Demo review of a ${i.file.contentType} file. In live mode Claude reads the document and checks names and dates against the case.`,
  };
}

const READABLE: Record<string, "pdf" | "image"> = { "application/pdf": "pdf", "image/jpeg": "image", "image/png": "image", "image/webp": "image" };

export async function reviewHeirDocument(actor: { id: string; role: Role }, documentId: string) {
  if (!can(actor.role, "case:write")) throw new ForbiddenError("Your role cannot run document reviews.");
  const doc = await prisma.heirDocument.findUniqueOrThrow({ where: { id: documentId }, include: { person: true, case: { include: { owner: true } } } });
  const file = await readFile(doc.fileId);
  if (!file) throw new ReviewError("The file is no longer stored.");
  const kind = READABLE[file.meta.contentType];
  if (!kind) throw new ReviewError("iPhone (HEIC) photos can't be read automatically. Ask the heir for a JPEG or PDF, or check it yourself.");
  if (file.bytes.length > 20 * 1024 * 1024) throw new ReviewError("The file is too large for automatic review (20 MB). Check it yourself.");
  const rule = await getActiveRule(prisma, doc.case.stateCode, "CLAIM_REQUIREMENTS", todayIn()).catch(() => null);
  const label = rule?.params.checklist.find((i) => i.key === doc.checklistKey)?.label ?? doc.checklistKey;
  const facts = {
    ownerName: doc.case.owner.fullName,
    ownerDateOfDeath: doc.case.owner.dateOfDeath ? formatDateOnly(doc.case.owner.dateOfDeath) : null,
    claimantName: doc.person.fullName,
    checklistKey: doc.checklistKey,
  };
  const run = await runPrompt({
    promptName: "claim-document-review",
    schema: DocumentReview,
    input: {
      expected: { checklistItem: doc.checklistKey, label },
      caseFacts: { ownerName: facts.ownerName, ownerDateOfDeath: facts.ownerDateOfDeath, claimantName: facts.claimantName, claimantRelationship: doc.person.relationship },
      file: { contentType: file.meta.contentType },
    },
    mock: mockDocumentReview,
    caseId: doc.caseId,
    entityType: "HeirDocument",
    entityId: doc.id,
    attachments: [{ kind, mediaType: file.meta.contentType as "application/pdf", base64: Buffer.from(file.bytes).toString("base64") }],
  });
  await writeAudit(prisma, {
    actor: { type: "USER", id: actor.id, role: actor.role },
    action: "document.ai_review_requested",
    entityType: "HeirDocument",
    entityId: doc.id,
    after: { aiRunId: run.runId, model: run.model, caseId: doc.caseId },
  });
  return { runId: run.runId, review: run.output, flags: consistencyFlags(run.output, facts) };
}

/** Latest AI review per document (for screens). */
export async function latestReviews(caseId: string) {
  const runs = await prisma.aiRun.findMany({
    where: { caseId, promptName: "claim-document-review", status: "SUCCEEDED", entityType: "HeirDocument" },
    orderBy: { createdAt: "desc" },
  });
  const docs = await prisma.heirDocument.findMany({ where: { caseId }, include: { person: true, case: { include: { owner: true } } } });
  const out = new Map<string, { runId: string; acceptance: string; review: DocumentReview; flags: ConsistencyFlag[]; model: string; at: string }>();
  for (const r of runs) {
    if (!r.entityId || out.has(r.entityId)) continue;
    const doc = docs.find((d) => d.id === r.entityId);
    const parsed = DocumentReview.safeParse(r.output);
    if (!doc || !parsed.success) continue;
    out.set(r.entityId, {
      runId: r.id,
      acceptance: r.acceptance,
      review: parsed.data,
      model: r.model,
      at: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
      flags: consistencyFlags(parsed.data, {
        ownerName: doc.case.owner.fullName,
        ownerDateOfDeath: doc.case.owner.dateOfDeath ? formatDateOnly(doc.case.owner.dateOfDeath) : null,
        claimantName: doc.person.fullName,
        checklistKey: doc.checklistKey,
      }),
    });
  }
  return out;
}
