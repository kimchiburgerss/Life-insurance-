/**
 * Background import processor (build spec 5.1):
 *   parse → normalize → de-duplicate by state property ID → group under
 *   probable owners (auto-merge only when confident; otherwise a review-queue
 *   entry) → create/attach cases → score → audit.
 *
 * All writes happen in ONE transaction, so a failed import leaves no partial
 * data and can simply be retried.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { prisma, type DbClient } from "@/lib/db";
import { todayIn } from "@/lib/dates";
import type { CaseStage } from "@/lib/generated/prisma/enums";
import { ownerMatchKeys, scoreOwnerMatch, type MatchableOwner, type MatchResult } from "@/lib/match/owner";
import { normalizeAddress, type NormalizedAddress } from "@/lib/normalize/address";
import { displayName, parseOwnerName } from "@/lib/normalize/name";
import { cleanText } from "@/lib/normalize/text";
import { rescoreCases } from "@/lib/screening/service";
import { ImportMappingSchema } from "./fields";
import { parseImportFile, type FileType } from "./parse";
import { normalizeRow, type NormalizedRecord } from "./row";

/** Cases still early enough that new properties can join them. */
export const OPEN_FOR_NEW_PROPERTIES: CaseStage[] = [
  "IMPORTED",
  "SCREENED",
  "OWNER_VERIFIED_DECEASED",
  "HEIRS_RESEARCHING",
  "HEIRS_IDENTIFIED",
  "WAITING_PERIOD",
  "READY_FOR_OUTREACH",
];

const MAX_STORED_ERRORS = 500;
const CHUNK = 1000;

type OwnerEntry = {
  id: string;
  isNew: boolean;
  matchable: MatchableOwner;
  addresses: MatchableOwner["address"][];
};

type StoredAddress = Partial<NormalizedAddress> & { postalCode?: string | null };

/** Accepts both normalized addresses and older {line1, city, state, postalCode} objects. */
export function toMatchAddress(a: StoredAddress | null | undefined): MatchableOwner["address"] {
  if (!a) return null;
  if (a.streetName !== undefined || a.zip5 !== undefined) {
    return { zip5: a.zip5 ?? null, streetNumber: a.streetNumber ?? null, streetName: a.streetName ?? null, isPoBox: Boolean(a.isPoBox) };
  }
  const n = normalizeAddress({ kind: "parts", line1: a.line1, city: a.city, state: a.state, zip: a.postalCode });
  return { zip5: n.zip5, streetNumber: n.streetNumber, streetName: n.streetName, isPoBox: n.isPoBox };
}

class OwnerIndex {
  private byKey = new Map<string, OwnerEntry[]>();

  add(entry: OwnerEntry, keys: string[]) {
    for (const k of keys) {
      const list = this.byKey.get(k) ?? [];
      list.push(entry);
      this.byKey.set(k, list);
    }
  }

  candidates(keys: string[]): OwnerEntry[] {
    const seen = new Map<string, OwnerEntry>();
    for (const k of keys) for (const e of this.byKey.get(k) ?? []) seen.set(e.id, e);
    return [...seen.values()];
  }
}

function bestMatch(record: MatchableOwner, candidates: OwnerEntry[]): { owner: OwnerEntry; result: MatchResult } | null {
  let best: { owner: OwnerEntry; result: MatchResult } | null = null;
  for (const c of candidates) {
    const addresses = c.addresses.length ? c.addresses : [null];
    for (const addr of addresses) {
      const result = scoreOwnerMatch(record, { ...c.matchable, address: addr });
      if (!best || result.score > best.result.score) best = { owner: c, result };
    }
  }
  return best;
}

async function loadExistingOwners(db: DbClient, keys: string[], index: OwnerIndex) {
  const unique = [...new Set(keys)];
  for (let i = 0; i < unique.length; i += 2000) {
    const owners = await db.owner.findMany({
      where: { matchKeys: { hasSome: unique.slice(i, i + 2000) }, mergedIntoId: null },
      select: { id: true, normalizedName: true, lastKnownAddresses: true, matchKeys: true },
    });
    for (const o of owners) {
      const parsed = parseOwnerName(o.normalizedName, "FIRST_LAST");
      const addresses = (Array.isArray(o.lastKnownAddresses) ? (o.lastKnownAddresses as StoredAddress[]) : [])
        .map(toMatchAddress)
        .filter(Boolean);
      index.add(
        { id: o.id, isNew: false, matchable: { tokens: parsed.tokens, suffix: parsed.suffix, address: addresses[0] ?? null }, addresses },
        o.matchKeys,
      );
    }
  }
}

/** A record worth a case under the RELEVANT filter. */
export function isRelevantRecord(r: NormalizedRecord): boolean {
  return (
    r.category === "LIFE_INSURANCE" ||
    r.category === "ANNUITY" ||
    r.category === "ESTATE" ||
    r.holderIsLifeInsurer ||
    r.hasDeceasedMarker
  );
}

export type ImportSummary = {
  rowCount: number;
  insertedCount: number;
  duplicateCount: number;
  errorCount: number;
  newOwnerCount: number;
  groupedCount: number;
  reviewCount: number;
  flaggedCount: number;
  newCaseCount: number;
};

export async function processImportBatch(batchId: string, opts: { today?: Date } = {}): Promise<ImportSummary> {
  const today = opts.today ?? todayIn();
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.status === "COMPLETED") throw new Error("This import has already been processed.");
  if (!batch.fileData) throw new Error("The uploaded file is no longer stored; upload it again.");
  await prisma.importBatch.update({ where: { id: batchId }, data: { status: "PROCESSING", startedAt: new Date(), failureMessage: null } });

  try {
    const mapping = ImportMappingSchema.parse(batch.columnMapping);
    const { rows } = await parseImportFile(batch.fileData, batch.fileType as FileType);

    // 1. Normalize
    const records: NormalizedRecord[] = [];
    const errors: { row: number; error: string }[] = [];
    rows.forEach((row, i) => {
      const r = normalizeRow(row, mapping, i + 2, batch.stateCode, today); // +2: header is row 1
      if (r.ok) records.push(r.record);
      else errors.push({ row: r.rowNumber, error: r.error });
    });

    // 2. De-duplicate (inside the file, then against earlier imports)
    const seen = new Set<string>();
    const unique: NormalizedRecord[] = [];
    let duplicateCount = 0;
    for (const r of records) {
      if (seen.has(r.statePropertyId)) {
        duplicateCount++;
      } else {
        seen.add(r.statePropertyId);
        unique.push(r);
      }
    }
    const existingIds = new Set<string>();
    for (let i = 0; i < unique.length; i += CHUNK) {
      const found = await prisma.property.findMany({
        where: { stateCode: batch.stateCode, statePropertyId: { in: unique.slice(i, i + CHUNK).map((r) => r.statePropertyId) } },
        select: { statePropertyId: true },
      });
      found.forEach((p) => existingIds.add(p.statePropertyId));
    }
    const fresh = unique.filter((r) => !existingIds.has(r.statePropertyId));
    duplicateCount += unique.length - fresh.length;

    // 3. Group under probable owners
    const index = new OwnerIndex();
    const recordKeys = fresh.map((r) => ownerMatchKeys(r.name.tokens));
    await loadExistingOwners(prisma, recordKeys.flat(), index);

    type NewOwner = { id: string; record: NormalizedRecord; keys: string[]; addresses: NormalizedAddress[]; aliases: Set<string> };
    const newOwners = new Map<string, NewOwner>();
    const ownerForRecord = new Map<NormalizedRecord, string>();
    const existingOwnerUpdates = new Map<string, { aliases: Set<string>; addresses: NormalizedAddress[] }>();
    const candidates: { newOwnerId: string; existingOwnerId: string; result: MatchResult }[] = [];
    let groupedCount = 0;

    fresh.forEach((record, i) => {
      const keys = recordKeys[i]!;
      const matchable: MatchableOwner = { tokens: record.name.tokens, suffix: record.name.suffix, address: record.address };
      const usable = !record.name.flags.includes("UNKNOWN") && !record.name.flags.includes("BUSINESS") && keys.length > 0;
      const best = usable ? bestMatch(matchable, index.candidates(keys)) : null;
      const alias = cleanText(record.ownerNameRaw);

      if (best && best.result.decision === "AUTO") {
        groupedCount++;
        ownerForRecord.set(record, best.owner.id);
        if (best.owner.isNew) {
          const o = newOwners.get(best.owner.id)!;
          o.aliases.add(alias);
          if (record.address) o.addresses.push(record.address);
        } else {
          const u = existingOwnerUpdates.get(best.owner.id) ?? { aliases: new Set<string>(), addresses: [] };
          u.aliases.add(alias);
          if (record.address) u.addresses.push(record.address);
          existingOwnerUpdates.set(best.owner.id, u);
        }
        if (record.address) best.owner.addresses.push(record.address);
        return;
      }

      const id = randomUUID();
      newOwners.set(id, { id, record, keys, addresses: record.address ? [record.address] : [], aliases: new Set([alias]) });
      ownerForRecord.set(record, id);
      if (best && best.result.decision === "REVIEW") {
        candidates.push({ newOwnerId: id, existingOwnerId: best.owner.id, result: best.result });
      }
      if (usable) {
        index.add({ id, isNew: true, matchable, addresses: record.address ? [record.address] : [] }, keys);
      }
    });

    // Cases: existing owners join their open case if it is still early; otherwise a new case.
    const touchedExisting = [...new Set([...ownerForRecord.values()].filter((id) => !newOwners.has(id)))];
    const openCaseByOwner = new Map<string, string>();
    for (let i = 0; i < touchedExisting.length; i += CHUNK) {
      const open = await prisma.case.findMany({
        where: { ownerId: { in: touchedExisting.slice(i, i + CHUNK) }, stage: { in: OPEN_FOR_NEW_PROPERTIES } },
        orderBy: { createdAt: "desc" },
        select: { id: true, ownerId: true },
      });
      for (const c of open) if (!openCaseByOwner.has(c.ownerId)) openCaseByOwner.set(c.ownerId, c.id);
    }
    // Which owners get a case at all (RELEVANT keeps statewide lists manageable).
    const relevantOwners = new Set<string>();
    for (const [record, ownerId] of ownerForRecord) {
      if (isRelevantRecord(record)) relevantOwners.add(ownerId);
    }
    const caseForOwner = new Map<string, { id: string; isNew: boolean }>();
    for (const ownerId of new Set(ownerForRecord.values())) {
      const open = openCaseByOwner.get(ownerId);
      if (open) caseForOwner.set(ownerId, { id: open, isNew: false });
      else if (mapping.options.caseFilter === "ALL" || relevantOwners.has(ownerId)) {
        caseForOwner.set(ownerId, { id: randomUUID(), isNew: true });
      }
    }

    // 4. Write everything atomically
    const newCaseIds = [...caseForOwner.values()].filter((c) => c.isNew).map((c) => c.id);
    const affectedCaseIds = [...new Set([...caseForOwner.values()].map((c) => c.id))];
    await prisma.$transaction(
      async (tx) => {
        const ownerRows = [...newOwners.values()].map((o) => ({
          id: o.id,
          stateCode: batch.stateCode,
          fullName: o.record.name.full ? displayName(o.record.name.full) : o.record.ownerNameRaw,
          normalizedName: o.record.name.full || cleanText(o.record.ownerNameRaw),
          aliases: [...o.aliases],
          lastKnownAddresses: o.addresses,
          matchKeys: o.keys,
        }));
        for (let i = 0; i < ownerRows.length; i += CHUNK) await tx.owner.createMany({ data: ownerRows.slice(i, i + CHUNK) });

        for (const [ownerId, u] of existingOwnerUpdates) {
          const o = await tx.owner.findUniqueOrThrow({ where: { id: ownerId }, select: { aliases: true, lastKnownAddresses: true } });
          await tx.owner.update({
            where: { id: ownerId },
            data: {
              aliases: [...new Set([...o.aliases, ...u.aliases])],
              lastKnownAddresses: [...(Array.isArray(o.lastKnownAddresses) ? o.lastKnownAddresses : []), ...u.addresses] as never,
            },
          });
        }

        const caseRows = [...caseForOwner.entries()]
          .filter(([, c]) => c.isNew)
          .map(([ownerId, c]) => ({ id: c.id, ownerId, stateCode: batch.stateCode }));
        for (let i = 0; i < caseRows.length; i += CHUNK) await tx.case.createMany({ data: caseRows.slice(i, i + CHUNK) });

        const propertyRows = fresh.map((r) => {
          const ownerId = ownerForRecord.get(r)!;
          return {
            stateCode: batch.stateCode,
            statePropertyId: r.statePropertyId,
            ownerNameRaw: r.ownerNameRaw,
            ownerNameNormalized: r.name.full || null,
            ownerNameParsed: { first: r.name.first, middle: r.name.middle, last: r.name.last, suffix: r.name.suffix, careOf: r.name.careOf, coOwner: r.name.coOwner },
            ownerAddressRaw: r.addressRaw,
            ownerAddressNormalized: r.address ?? undefined,
            holderName: r.holderName,
            propertyTypeCode: r.propertyTypeCode,
            category: r.category,
            reportedAmountCents: r.amountCents,
            amountIsMinimum: r.amountIsMinimum,
            datePresumedAbandoned: r.presumedAbandoned?.date ?? null,
            dateDeliveredToState: r.delivered?.date ?? null,
            dateDeliveredPrecision: r.delivered?.precision ?? null,
            flags: r.flags,
            sourceRowNumber: r.rowNumber,
            hasDeceasedMarker: r.hasDeceasedMarker,
            holderIsLifeInsurer: r.holderIsLifeInsurer,
            rawRecord: r.raw as never,
            importBatchId: batch.id,
            ownerId,
            caseId: caseForOwner.get(ownerId)?.id ?? null,
          };
        });
        for (let i = 0; i < propertyRows.length; i += CHUNK) await tx.property.createMany({ data: propertyRows.slice(i, i + CHUNK) });

        const candidateRows = candidates.map((c) => ({
          newOwnerId: c.newOwnerId,
          existingOwnerId: c.existingOwnerId,
          score: c.result.score,
          reasons: c.result.reasons,
          importBatchId: batch.id,
        }));
        for (let i = 0; i < candidateRows.length; i += CHUNK) {
          await tx.ownerMatchCandidate.createMany({ data: candidateRows.slice(i, i + CHUNK), skipDuplicates: true });
        }

        const actorId = batch.createdById ?? "import";
        const auditRows = [
          ...newCaseIds.map((id) => ({
            actorType: "SYSTEM" as const,
            actorId: `import:${batch.id}`,
            action: "case.created",
            entityType: "Case",
            entityId: id,
            after: { stage: "IMPORTED", importBatchId: batch.id },
          })),
          ...affectedCaseIds
            .filter((id) => !newCaseIds.includes(id))
            .map((id) => ({
              actorType: "SYSTEM" as const,
              actorId: `import:${batch.id}`,
              action: "case.properties_added",
              entityType: "Case",
              entityId: id,
              after: { importBatchId: batch.id },
            })),
          {
            actorType: "USER" as const,
            actorId,
            action: "import.completed",
            entityType: "ImportBatch",
            entityId: batch.id,
            after: {
              rows: rows.length,
              inserted: fresh.length,
              duplicates: duplicateCount,
              errors: errors.length,
              newOwners: newOwners.size,
              grouped: groupedCount,
              review: candidates.length,
              newCases: newCaseIds.length,
            },
          },
        ];
        for (let i = 0; i < auditRows.length; i += CHUNK) await tx.auditLog.createMany({ data: auditRows.slice(i, i + CHUNK) });

        await rescoreCases(tx, affectedCaseIds, today);
      },
      { timeout: 15 * 60_000, maxWait: 30_000 },
    );

    const summary: ImportSummary = {
      rowCount: rows.length,
      insertedCount: fresh.length,
      duplicateCount,
      errorCount: errors.length,
      newOwnerCount: newOwners.size,
      groupedCount,
      reviewCount: candidates.length,
      flaggedCount: fresh.filter((r) => r.hasDeceasedMarker || r.holderIsLifeInsurer).length,
      newCaseCount: newCaseIds.length,
    };
    await prisma.importBatch.update({
      where: { id: batchId },
      data: {
        ...summary,
        errors: errors.slice(0, MAX_STORED_ERRORS),
        status: "COMPLETED",
        completedAt: new Date(),
        fileData: null, // the parsed rows now live in `properties`
      },
    });
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.importBatch.update({ where: { id: batchId }, data: { status: "FAILED", failureMessage: message.slice(0, 2000) } });
    throw e;
  }
}
