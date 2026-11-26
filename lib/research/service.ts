/**
 * Research operations behind the case page (build spec 5.3, 5.4). Every
 * mutation checks the actor's permission, writes an audit entry (no PII), and
 * keeps AI output as a suggestion until a human accepts it.
 */
import "server-only";
import { z } from "zod";
import { getDeathRecordSources } from "@/adapters/death-records";
import { getPeopleSearchProvider, permissiblePurpose, type PeopleSearchMatch } from "@/adapters/people-search";
import { decideAiRun } from "@/lib/ai/acceptance";
import { runPrompt } from "@/lib/ai/run";
import { writeAudit } from "@/lib/audit";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import { blindIndex, encryptOptional, redactSsnLike } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { formatDateOnly, maxDate, parseDateOnly, todayIn } from "@/lib/dates";
import type { EvidenceSourceType, PersonStatus, Relationship, Role } from "@/lib/generated/prisma/enums";
import { scoreOwnerMatch } from "@/lib/match/owner";
import { displayName, parseOwnerName } from "@/lib/normalize/name";
import { cleanText } from "@/lib/normalize/text";
import { rescoreCases } from "@/lib/screening/service";
import { assessDeathMatch, type DeathMatch } from "./death";
import {
  extractObituaryHeuristic,
  initialConfidence,
  ObituaryExtraction,
  quoteAppears,
  toPersonRelationship,
} from "./obituary";

export type Actor = { id: string; role: Role };
export class ResearchError extends Error {}

function requireWrite(actor: Actor) {
  if (!can(actor.role, "case:write")) throw new ForbiddenError("Your role can't change research data.");
}
const audit = (actor: Actor) => ({ type: "USER" as const, id: actor.id, role: actor.role });

// ─── Evidence ───────────────────────────────────────────────────────────────

export async function addEvidence(
  actor: Actor,
  input: { caseId: string; sourceType: EvidenceSourceType; title: string; url?: string | null; rawText?: string | null; supportsDeath: boolean },
) {
  requireWrite(actor);
  const url = input.url?.trim() || null;
  if (url && !/^https?:\/\//i.test(url)) throw new ResearchError("The link must start with http:// or https://");
  if (!input.title.trim()) throw new ResearchError("Give the source a title.");
  const ev = await prisma.evidence.create({
    data: {
      caseId: input.caseId,
      sourceType: input.sourceType,
      title: input.title.trim().slice(0, 300),
      url,
      // Pasted documents (e.g. a death certificate) may contain an SSN; never store it.
      rawText: input.rawText?.trim() ? redactSsnLike(input.rawText.trim()) : null,
      supportsDeath: input.supportsDeath,
      addedByUserId: actor.id,
    },
  });
  await writeAudit(prisma, {
    actor: audit(actor),
    action: "evidence.added",
    entityType: "Case",
    entityId: input.caseId,
    after: { evidenceId: ev.id, sourceType: ev.sourceType, title: ev.title, url: ev.url, supportsDeath: ev.supportsDeath },
  });
  return ev;
}

async function ownerContext(caseId: string) {
  const c = await prisma.case.findUniqueOrThrow({
    where: { id: caseId },
    select: {
      owner: { select: { id: true, fullName: true, aliases: true, dateOfBirth: true, dateOfDeath: true, lastKnownAddresses: true } },
      properties: { select: { datePresumedAbandoned: true, dateDeliveredToState: true } },
    },
  });
  const addrs = (Array.isArray(c.owner.lastKnownAddresses) ? c.owner.lastKnownAddresses : []) as { city?: string | null; state?: string | null }[];
  return {
    owner: c.owner,
    cities: [...new Set(addrs.map((a) => a.city).filter((x): x is string => Boolean(x)))],
    state: addrs.find((a) => a.state)?.state ?? "NV",
    latestPropertyDate: maxDate(c.properties.flatMap((p) => [p.datePresumedAbandoned, p.dateDeliveredToState]).filter((d): d is Date => Boolean(d))) ?? null,
  };
}

/** Search the configured death-record sources (nothing is saved until the operator adds a result). */
export async function searchDeathRecords(actor: Actor, caseId: string) {
  requireWrite(actor);
  const ctx = await ownerContext(caseId);
  const query = {
    fullName: ctx.owner.fullName,
    aliases: ctx.owner.aliases,
    city: ctx.cities[0] ?? null,
    state: ctx.state,
    birthYear: ctx.owner.dateOfBirth?.getUTCFullYear() ?? null,
  };
  const results = (await Promise.all(getDeathRecordSources().map((s) => s.search(query)))).flat();
  await writeAudit(prisma, {
    actor: audit(actor),
    action: "research.death_record_search",
    entityType: "Case",
    entityId: caseId,
    after: { sources: getDeathRecordSources().map((s) => s.id), results: results.length },
  });
  return results;
}

// ─── Obituary extraction ────────────────────────────────────────────────────

export async function extractObituary(actor: Actor, evidenceId: string) {
  requireWrite(actor);
  const ev = await prisma.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
  if (!ev.rawText) throw new ResearchError("Paste the obituary text into this evidence first.");
  const result = await runPrompt({
    promptName: "obituary-extraction",
    schema: ObituaryExtraction,
    // Only the obituary text is sent — no owner PII.
    input: { obituaryText: ev.rawText },
    mock: (input) => extractObituaryHeuristic(String(input.obituaryText)),
    caseId: ev.caseId,
    entityType: "Evidence",
    entityId: ev.id,
  });
  return result;
}

/** Death-match assessment for an extraction (shown next to the suggestion). */
export async function assessExtraction(caseId: string, extraction: ObituaryExtraction): Promise<DeathMatch> {
  const ctx = await ownerContext(caseId);
  return assessDeathMatch(
    {
      fullName: ctx.owner.fullName,
      aliases: ctx.owner.aliases,
      dateOfBirth: ctx.owner.dateOfBirth,
      cities: ctx.cities,
      latestPropertyDate: ctx.latestPropertyDate,
    },
    extraction,
  );
}

/**
 * Accept an obituary extraction: store the facts on the evidence, optionally
 * mark it as confirming the owner's death, and add the selected relatives as
 * heir CANDIDATES (never auto-confirmed, never merged with a different name).
 */
export async function acceptObituaryExtraction(
  actor: Actor,
  input: { aiRunId: string; confirmsOwnerDeath: boolean; relativeIndexes: number[]; note?: string },
) {
  requireWrite(actor);
  return prisma.$transaction(async (tx) => {
    const run = await tx.aiRun.findUniqueOrThrow({ where: { id: input.aiRunId } });
    if (run.promptName !== "obituary-extraction" || run.entityType !== "Evidence" || !run.entityId || !run.caseId) {
      throw new ResearchError("This AI result is not an obituary extraction.");
    }
    const ext = ObituaryExtraction.parse(run.output);
    const ev = await tx.evidence.findUniqueOrThrow({ where: { id: run.entityId } });
    await decideAiRun(tx, { aiRunId: run.id, decision: "ACCEPTED", actor, note: input.note });

    await tx.evidence.update({
      where: { id: ev.id },
      data: { extractedFacts: ext as never, addedByAiRunId: run.id, supportsDeath: input.confirmsOwnerDeath || ev.supportsDeath },
    });
    if (input.confirmsOwnerDeath) {
      const owner = await tx.owner.findFirstOrThrow({ where: { cases: { some: { id: run.caseId } } } });
      let dod: Date | null = null;
      try {
        dod = ext.deceased.dateOfDeath ? parseDateOnly(ext.deceased.dateOfDeath) : null;
      } catch {
        dod = null;
      }
      await tx.owner.update({
        where: { id: owner.id },
        data: {
          deathVerified: true,
          deathVerificationNote: `${ev.sourceType.toLowerCase().replaceAll("_", " ")}: ${ev.title}`,
          ...(dod && !owner.dateOfDeath ? { dateOfDeath: dod } : {}),
        },
      });
    }

    const existing = await tx.person.findMany({ where: { caseId: run.caseId } });
    const created: string[] = [];
    const linked: string[] = [];
    for (const idx of input.relativeIndexes) {
      const r = ext.relatives[idx];
      if (!r) continue;
      const relationship = toPersonRelationship(r.relationship);
      const normalizedName = cleanText(r.name);
      const same = existing.find((p) => p.normalizedName === normalizedName && p.relationship === relationship);
      if (same) {
        // Exact same name + relationship: add this source to the existing candidate.
        await tx.person.update({ where: { id: same.id }, data: { sourceEvidenceIds: [...new Set([...same.sourceEvidenceIds, ev.id])] } });
        linked.push(same.id);
        continue;
      }
      const parent = r.throughRelativeName
        ? existing.find((p) => p.normalizedName === cleanText(r.throughRelativeName))
        : undefined;
      const found = quoteAppears(r.evidenceQuote, ev.rawText ?? "");
      const person = await tx.person.create({
        data: {
          caseId: run.caseId,
          fullName: displayName(cleanText(r.name)),
          normalizedName,
          relationship,
          relationshipConfidence: initialConfidence(r, found),
          isPredeceased: r.status === "PREDECEASED",
          parentPersonId: parent?.id ?? null,
          sourceEvidenceIds: [ev.id],
          notes: `${r.relationship !== relationship ? `Listed as ${r.relationship.toLowerCase().replace("_", " ")}. ` : ""}Source: “${r.evidenceQuote.slice(0, 200)}”${found ? "" : " (quote not found verbatim in the text — check it)"}`,
        },
      });
      existing.push(person);
      created.push(person.id);
    }
    await writeAudit(tx, {
      actor: audit(actor),
      action: "research.obituary_accepted",
      entityType: "Case",
      entityId: run.caseId,
      after: { evidenceId: ev.id, aiRunId: run.id, confirmsOwnerDeath: input.confirmsOwnerDeath, personsCreated: created.length, personsLinked: linked.length },
    });
    return { created, linked };
  });
}

export async function rejectAiSuggestion(actor: Actor, aiRunId: string, note?: string) {
  requireWrite(actor);
  return decideAiRun(prisma, { aiRunId, decision: "REJECTED", actor, note });
}

// ─── People ─────────────────────────────────────────────────────────────────

const PersonInput = z.object({
  fullName: z.string().trim().min(2).max(200),
  relationship: z.enum(["NAMED_BENEFICIARY", "SPOUSE", "CHILD", "GRANDCHILD", "PARENT", "SIBLING", "NIECE_NEPHEW", "GRANDPARENT", "AUNT_UNCLE", "COUSIN", "OTHER", "UNKNOWN"]),
  isPredeceased: z.boolean(),
  parentPersonId: z.string().nullable(),
  relationshipConfidence: z.number().min(0).max(1),
  status: z.enum(["CANDIDATE", "CONFIRMED", "REJECTED"]),
  notes: z.string().max(2000).nullable(),
});

export async function savePerson(actor: Actor, caseId: string, personId: string | null, raw: z.input<typeof PersonInput>) {
  requireWrite(actor);
  const data = PersonInput.parse(raw);
  if (data.parentPersonId && data.parentPersonId === personId) throw new ResearchError("A person can't be their own parent.");
  const fields = {
    fullName: data.fullName,
    normalizedName: cleanText(data.fullName),
    relationship: data.relationship as Relationship,
    isPredeceased: data.isPredeceased,
    parentPersonId: data.parentPersonId,
    relationshipConfidence: data.relationshipConfidence,
    status: data.status as PersonStatus,
    notes: data.notes ? redactSsnLike(data.notes) : null,
  };
  const before = personId ? await prisma.person.findUniqueOrThrow({ where: { id: personId } }) : null;
  if (before && before.caseId !== caseId) throw new ResearchError("Person belongs to another case.");
  const person = personId
    ? await prisma.person.update({ where: { id: personId }, data: fields })
    : await prisma.person.create({ data: { caseId, ...fields } });
  await writeAudit(prisma, {
    actor: audit(actor),
    action: personId ? "person.updated" : "person.added",
    entityType: "Person",
    entityId: person.id,
    before: before ? { relationship: before.relationship, status: before.status, isPredeceased: before.isPredeceased, confidence: before.relationshipConfidence } : undefined,
    after: { caseId, relationship: person.relationship, status: person.status, isPredeceased: person.isPredeceased, confidence: person.relationshipConfidence },
  });
  return person;
}

/** Pairs of people in a case that might be the same person (shown for human review; never auto-merged). */
export async function possibleDuplicates(caseId: string) {
  const people = await prisma.person.findMany({ where: { caseId, status: { not: "REJECTED" } }, select: { id: true, fullName: true } });
  const pairs: { a: { id: string; fullName: string }; b: { id: string; fullName: string }; score: number }[] = [];
  for (let i = 0; i < people.length; i++)
    for (let j = i + 1; j < people.length; j++) {
      const [a, b] = [parseOwnerName(people[i]!.fullName, "FIRST_LAST"), parseOwnerName(people[j]!.fullName, "FIRST_LAST")];
      const r = scoreOwnerMatch({ tokens: a.tokens, suffix: a.suffix, address: null }, { tokens: b.tokens, suffix: b.suffix, address: null });
      if (r.score >= 0.85) pairs.push({ a: people[i]!, b: people[j]!, score: r.score });
    }
  return pairs;
}

export async function mergePersons(actor: Actor, caseId: string, keepId: string, removeId: string) {
  requireWrite(actor);
  if (keepId === removeId) throw new ResearchError("Pick two different people.");
  await prisma.$transaction(async (tx) => {
    const [keep, remove] = await Promise.all([
      tx.person.findUniqueOrThrow({ where: { id: keepId } }),
      tx.person.findUniqueOrThrow({ where: { id: removeId } }),
    ]);
    if (keep.caseId !== caseId || remove.caseId !== caseId) throw new ResearchError("Both people must belong to this case.");
    if ((await tx.communication.count({ where: { personId: removeId } })) > 0) {
      throw new ResearchError("The person being removed already has communications; merge by hand.");
    }
    await tx.person.update({
      where: { id: keepId },
      data: {
        sourceEvidenceIds: [...new Set([...keep.sourceEvidenceIds, ...remove.sourceEvidenceIds])],
        emailEnc: keep.emailEnc ?? remove.emailEnc,
        emailHash: keep.emailHash ?? remove.emailHash,
        phoneEnc: keep.phoneEnc ?? remove.phoneEnc,
        mailingAddressEnc: keep.mailingAddressEnc ?? remove.mailingAddressEnc,
        relationshipConfidence: Math.max(keep.relationshipConfidence, remove.relationshipConfidence),
        notes: [keep.notes, remove.notes && `Merged from ${remove.fullName}: ${remove.notes}`].filter(Boolean).join("\n"),
      },
    });
    await tx.person.updateMany({ where: { parentPersonId: removeId }, data: { parentPersonId: keepId } });
    await tx.evidence.updateMany({ where: { personId: removeId }, data: { personId: keepId } });
    await tx.person.delete({ where: { id: removeId } });
    await writeAudit(tx, { actor: audit(actor), action: "person.merged", entityType: "Person", entityId: keepId, before: { removedPersonId: removeId } });
  });
}

// ─── Contact lookup ─────────────────────────────────────────────────────────

/** Run the people-search vendor for one heir candidate. Results are NOT stored until the operator saves one. */
export async function lookupContact(actor: Actor, personId: string, purposeConfirmed: boolean): Promise<{ provider: string; matches: PeopleSearchMatch[] }> {
  requireWrite(actor);
  if (!purposeConfirmed) throw new ResearchError("Confirm the permissible purpose before running a lookup.");
  const provider = getPeopleSearchProvider();
  if (!provider) throw new ResearchError("No people-search vendor is configured yet. Enter contact details manually.");
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId }, include: { case: { include: { persons: { select: { fullName: true } } } } } });
  const purpose = permissiblePurpose();
  const matches = await provider.lookup({
    fullName: person.fullName,
    city: null,
    state: "NV",
    relativeNames: person.case.persons.map((p) => p.fullName).filter((n) => n !== person.fullName),
    permissiblePurpose: purpose,
  });
  await writeAudit(prisma, {
    actor: audit(actor),
    action: "contact.lookup",
    entityType: "Person",
    entityId: personId,
    after: { provider: provider.id, permissiblePurpose: purpose, caseId: person.caseId, results: matches.length },
  });
  return { provider: provider.name, matches };
}

const ContactInput = z.object({
  address: z.string().trim().max(300).nullable(),
  phone: z.string().trim().max(40).nullable(),
  email: z.string().trim().toLowerCase().email().max(200).nullable().or(z.literal("").transform(() => null)),
  source: z.enum(["VENDOR", "MANUAL"]),
  sourceDetail: z.string().trim().max(300),
  vendorRecordId: z.string().max(100).nullable(),
});

/** Store contact details encrypted, with a source record (no PII in evidence or audit). */
export async function saveContact(actor: Actor, personId: string, raw: z.input<typeof ContactInput>) {
  requireWrite(actor);
  const c = ContactInput.parse(raw);
  if (!c.address && !c.phone && !c.email) throw new ResearchError("Enter at least one way to reach this person.");
  return prisma.$transaction(async (tx) => {
    const person = await tx.person.findUniqueOrThrow({ where: { id: personId } });
    const ev = await tx.evidence.create({
      data: {
        caseId: person.caseId,
        personId,
        sourceType: c.source === "VENDOR" ? "PEOPLE_SEARCH_VENDOR" : "MANUAL_NOTE",
        title: c.source === "VENDOR" ? `Contact lookup: ${c.sourceDetail}` : `Contact entered manually: ${c.sourceDetail || "operator"}`,
        addedByUserId: actor.id,
        extractedFacts: {
          fieldsProvided: [c.address && "address", c.phone && "phone", c.email && "email"].filter(Boolean),
          vendorRecordId: c.vendorRecordId,
          permissiblePurpose: c.source === "VENDOR" ? permissiblePurpose() : null,
        },
      },
    });
    await tx.person.update({
      where: { id: personId },
      data: {
        ...(c.address ? { mailingAddressEnc: encryptOptional(c.address) } : {}),
        ...(c.phone ? { phoneEnc: encryptOptional(c.phone) } : {}),
        ...(c.email ? { emailEnc: encryptOptional(c.email), emailHash: blindIndex(c.email) } : {}),
        sourceEvidenceIds: [...new Set([...person.sourceEvidenceIds, ev.id])],
      },
    });
    await writeAudit(tx, {
      actor: audit(actor),
      action: "contact.saved",
      entityType: "Person",
      entityId: personId,
      after: { caseId: person.caseId, evidenceId: ev.id, source: c.source, fields: (ev.extractedFacts as { fieldsProvided: string[] }).fieldsProvided },
    });
  });
}

// ─── AI research summary & tracing estimate ─────────────────────────────────

export const ResearchSummary = z.object({
  known: z.array(z.string()),
  uncertain: z.array(z.string()),
  nextSteps: z.array(z.object({ step: z.string(), why: z.string() })),
  outreachReadiness: z.string(),
});
export type ResearchSummary = z.infer<typeof ResearchSummary>;

export const TracingEstimate = z.object({ difficulty: z.number().int().min(1).max(5), rationale: z.string() });

/** The case file sent to the model: facts and research state, but no contact details. */
async function caseFile(caseId: string) {
  const c = await prisma.case.findUniqueOrThrow({
    where: { id: caseId },
    include: {
      owner: true,
      properties: { select: { category: true, holderName: true, reportedAmountCents: true, dateDeliveredToState: true, flags: true } },
      evidence: { select: { id: true, sourceType: true, title: true, supportsDeath: true, extractedFacts: true } },
      persons: true,
    },
  });
  return {
    stage: c.stage,
    eligibleContractDate: c.eligibleContractDate ? formatDateOnly(c.eligibleContractDate) : null,
    today: formatDateOnly(todayIn()),
    owner: {
      name: c.owner.fullName,
      otherNames: c.owner.aliases,
      dateOfBirth: c.owner.dateOfBirth ? formatDateOnly(c.owner.dateOfBirth) : null,
      dateOfDeath: c.owner.dateOfDeath ? formatDateOnly(c.owner.dateOfDeath) : null,
      deathVerified: c.owner.deathVerified,
      lastKnownCities: ((c.owner.lastKnownAddresses as { city?: string; state?: string }[]) ?? []).map((a) => [a.city, a.state].filter(Boolean).join(", ")),
    },
    properties: c.properties.map((p) => ({
      type: p.category,
      holder: p.holderName,
      amountUsd: p.reportedAmountCents === null ? null : p.reportedAmountCents / 100,
      deliveredToState: p.dateDeliveredToState ? formatDateOnly(p.dateDeliveredToState) : null,
      flags: p.flags,
    })),
    evidence: c.evidence.map((e) => {
      const facts = e.extractedFacts as Record<string, unknown> | null;
      return {
        id: e.id,
        sourceType: e.sourceType,
        title: e.title,
        confirmsOwnerDeath: e.supportsDeath,
        relativesNamed: Array.isArray(facts?.relatives) ? (facts!.relatives as { name: string; relationship: string; status: string }[]).map((r) => `${r.name} (${r.relationship}, ${r.status})`) : undefined,
      };
    }),
    people: c.persons.map((p) => ({
      name: p.fullName,
      relationship: p.relationship,
      status: p.status,
      predeceased: p.isPredeceased,
      confidence: p.relationshipConfidence,
      sources: p.sourceEvidenceIds.length,
      hasMailingAddress: Boolean(p.mailingAddressEnc),
      hasEmail: Boolean(p.emailEnc),
      linkedToParent: Boolean(p.parentPersonId),
    })),
  };
}

function mockSummary(file: Awaited<ReturnType<typeof caseFile>>): ResearchSummary {
  const known: string[] = [];
  const uncertain: string[] = [];
  const nextSteps: ResearchSummary["nextSteps"] = [];
  const deathSources = file.evidence.filter((e) => e.confirmsOwnerDeath);
  if (deathSources.length) known.push(`Owner's death is supported by ${deathSources.length} source(s) (${deathSources[0]!.sourceType.toLowerCase()}).`);
  else {
    uncertain.push("No source confirms the owner's death yet.");
    nextSteps.push({ step: "Find an obituary or death-index record for the owner.", why: "Death must be cited before heir research counts." });
  }
  const live = file.people.filter((p) => p.status !== "REJECTED" && !p.predeceased);
  if (live.length) known.push(`${live.length} possible heir(s) named: ${live.map((p) => `${p.name} (${p.relationship.toLowerCase()})`).join(", ")}.`);
  const unconfirmed = live.filter((p) => p.status === "CANDIDATE");
  if (unconfirmed.length) {
    uncertain.push(`${unconfirmed.length} relationship(s) not yet confirmed.`);
    nextSteps.push({ step: `Confirm ${unconfirmed[0]!.name}'s relationship with a second source.`, why: "Each heir needs two independent sources." });
  }
  const noContact = live.filter((p) => !p.hasMailingAddress);
  if (noContact.length) {
    uncertain.push(`${noContact.length} heir candidate(s) have no mailing address.`);
    nextSteps.push({ step: `Run a contact lookup for ${noContact[0]!.name}.`, why: "Outreach is by mail first." });
  }
  if (file.properties.some((p) => !p.deliveredToState)) uncertain.push("A property's delivery date is unknown, so the waiting period can't be confirmed.");
  if (file.stage === "WAITING_PERIOD") known.push(`In the 24-month waiting period until ${file.eligibleContractDate}; no outreach before then.`);
  return {
    known,
    uncertain,
    nextSteps: nextSteps.slice(0, 4),
    outreachReadiness: live.some((p) => p.status === "CONFIRMED" && p.hasMailingAddress)
      ? "At least one confirmed heir has a mailing address; research looks sufficient for outreach once the case is eligible."
      : "Not ready: no confirmed heir with a mailing address yet.",
  };
}

export async function generateResearchSummary(actor: Actor, caseId: string) {
  requireWrite(actor);
  const file = await caseFile(caseId);
  return runPrompt({
    promptName: "research-summary",
    schema: ResearchSummary,
    input: file,
    mock: () => mockSummary(file),
    caseId,
    entityType: "Case",
    entityId: caseId,
  });
}

export async function estimateTracing(actor: Actor, caseId: string) {
  requireWrite(actor);
  const file = await caseFile(caseId);
  return runPrompt({
    promptName: "tracing-difficulty",
    schema: TracingEstimate,
    input: { owner: file.owner, properties: file.properties, evidenceCount: file.evidence.length, people: file.people.length },
    mock: () => {
      let d = 3;
      if (file.owner.deathVerified) d--;
      if (file.people.length > 1) d--;
      if (file.owner.lastKnownCities.length === 0) d += 2;
      const difficulty = Math.max(1, Math.min(5, d));
      return { difficulty, rationale: `Rule-based estimate: ${file.owner.deathVerified ? "death documented" : "death not yet documented"}, ${file.people.length} relative(s) found, ${file.owner.lastKnownCities.length ? "last city known" : "no known address"}.` };
    },
    caseId,
    entityType: "Case",
    entityId: caseId,
  });
}

export async function acceptTracingEstimate(actor: Actor, aiRunId: string) {
  requireWrite(actor);
  const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: aiRunId } });
  if (run.promptName !== "tracing-difficulty" || !run.caseId) throw new ResearchError("Not a tracing estimate.");
  const est = TracingEstimate.parse(run.output);
  await prisma.$transaction(async (tx) => {
    await decideAiRun(tx, { aiRunId, decision: "ACCEPTED", actor });
    await tx.case.update({
      where: { id: run.caseId! },
      data: { tracingAssessment: { difficulty: est.difficulty, rationale: est.rationale, aiRunId, acceptedAt: new Date().toISOString() } },
    });
    await rescoreCases(tx, [run.caseId!]);
  });
}

export async function acceptSummary(actor: Actor, aiRunId: string) {
  requireWrite(actor);
  return decideAiRun(prisma, { aiRunId, decision: "ACCEPTED", actor });
}

export async function caseAiCostMicros(caseId: string): Promise<number> {
  const agg = await prisma.aiRun.aggregate({ where: { caseId }, _sum: { costMicros: true } });
  return agg._sum.costMicros ?? 0;
}
