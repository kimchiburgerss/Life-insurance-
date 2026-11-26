import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { formatDateOnly, parseDateOnly } from "@/lib/dates";
import { processImportBatch } from "@/lib/import/process";
import { decideOwnerMatch, ReviewError } from "@/lib/import/review";
import { confirmImportMapping, createImportBatch, DuplicateFileError } from "@/lib/import/upload";
import { parseImportFile } from "@/lib/import/parse";
import { makeUser } from "../helpers/factories";

const today = parseDateOnly("2026-11-26");
let userId: string;

// Each run uses its own property-ID prefix so the shared test DB never collides.
const RUN = `R${Date.now().toString(36).toUpperCase()}`;
function fixture(name: string): Uint8Array {
  const text = readFileSync(`tests/fixtures/${name}`, "utf8").replace(/\bP-(\d{4})\b/g, `${RUN}-$1`);
  return new TextEncoder().encode(text);
}

async function runImport(name: string) {
  const batch = await createImportBatch({ fileName: name, data: fixture(name), source: "test", createdById: userId });
  await confirmImportMapping({ batchId: batch.id, mapping: batch.columnMapping, actorId: userId });
  const summary = await processImportBatch(batch.id, { today });
  return { batch, summary };
}

const prop = (n: string) =>
  prisma.property.findFirstOrThrow({
    where: { statePropertyId: `${RUN}-${n}` },
    include: { owner: true, case: true },
  });

beforeAll(async () => {
  userId = (await makeUser("OWNER")).user.id;
});
afterAll(() => prisma.$disconnect());

describe("CSV import pipeline", () => {
  let first: Awaited<ReturnType<typeof runImport>>;

  beforeAll(async () => {
    first = await runImport("import-first.csv");
  });

  it("auto-suggests the column mapping from headers", async () => {
    expect(first.batch.columnMapping).toMatchObject({
      fields: {
        statePropertyId: "Property ID",
        ownerName: "Owner Name",
        addressLine1: "Address",
        city: "City",
        state: "State",
        zip: "Zip",
        holderName: "Holder Name",
        propertyTypeCode: "Property Type",
        amount: "Cash Reported",
        dateDeliveredToState: "Date Remitted",
      },
    });
  });

  it("reports rows, duplicates and row errors", () => {
    expect(first.summary).toMatchObject({
      rowCount: 9, // blank line skipped
      errorCount: 1, // 13/45/2020
      duplicateCount: 1, // P-1001 twice
      insertedCount: 7,
    });
  });

  it("stores the failing row number and reason", async () => {
    const b = await prisma.importBatch.findUniqueOrThrow({ where: { id: first.batch.id } });
    expect(b.status).toBe("COMPLETED");
    expect(b.fileData).toBeNull();
    expect(b.errors).toEqual([{ row: 9, error: expect.stringMatching(/Invalid calendar date/) }]);
  });

  it("groups 'ESTATE OF JOHN A SMITH' and 'SMITH JOHN A DECD' at the same address", async () => {
    const a = await prop("1001");
    const b = await prop("1002");
    expect(a.ownerId).toBe(b.ownerId);
    expect(a.caseId).toBe(b.caseId);
    expect(a.owner!.fullName).toBe("John A Smith");
    expect(a.hasDeceasedMarker && b.hasDeceasedMarker).toBe(true);
    expect(a.holderIsLifeInsurer).toBe(true);
    expect(a.category).toBe("LIFE_INSURANCE");
    expect(b.dateDeliveredPrecision).toBe("YEAR");
    expect(formatDateOnly(b.dateDeliveredToState!)).toBe("2019-12-31");
    expect(b.flags).toContain("DATE_APPROXIMATE");
  });

  it("scores the grouped case with an explanation and expected value", async () => {
    const { case: c } = await prop("1001");
    expect(c!.stage).toBe("IMPORTED");
    // 30 life insurance + 21 ($15,000) + 12 estate marker + 5 life insurer
    // + 8 held 5+ years + 2 (two properties) − 3 common surname = 75
    expect(c!.priorityScore).toBe(75);
    expect(c!.priorityFactors).toEqual(
      expect.arrayContaining([
        { label: "life insurance proceeds", points: 30 },
        { label: "very common surname (harder to trace)", points: -3 },
      ]),
    );
    expect(c!.estimatedValueCents).toBe(1_500_000);
    // 20% tier (held 5+ years at signing) × default success estimate
    expect(c!.expectedValueCents).toBe(Math.round((1_500_000 * 2000 * c!.successProbability!) / 10_000));
    expect(c!.priorityExplanation).toMatch(/life insurance proceeds/);
    expect(c!.priorityExplanation).toMatch(/fee rate 20%/);
    expect(formatDateOnly(c!.eligibleContractDate!)).toBe("2022-01-01"); // latest property (2019-12-31) + 24 mo + 1 day
  });

  it("queues the nickname match for human review instead of merging", async () => {
    const william = await prop("1003");
    const bill = await prop("1004");
    expect(william.ownerId).not.toBe(bill.ownerId);
    const candidate = await prisma.ownerMatchCandidate.findFirstOrThrow({
      where: { importBatchId: first.batch.id, OR: [{ newOwnerId: bill.ownerId! }, { newOwnerId: william.ownerId! }] },
    });
    expect(candidate.status).toBe("PENDING");
    expect(JSON.stringify(candidate.reasons)).toMatch(/nickname/);
  });

  it("flags businesses and unknown owners and scores them low", async () => {
    const biz = await prop("1005");
    const unknown = await prop("1006");
    expect(biz.flags).toContain("BUSINESS");
    expect(unknown.flags).toEqual(expect.arrayContaining(["UNKNOWN", "NO_ADDRESS"]));
    expect(biz.case!.priorityScore!).toBeLessThan(20);
    expect(unknown.case!.priorityScore!).toBeLessThan(20);
  });

  it("keeps the lower bound of an amount range and marks it", async () => {
    const p = await prop("1003");
    expect(p.reportedAmountCents).toBe(10_000);
    expect(p.amountIsMinimum).toBe(true);
  });

  it("recent deliveries are in the waiting period", async () => {
    const { case: c } = await prop("1008");
    expect(formatDateOnly(c!.eligibleContractDate!)).toBe("2027-12-02");
    expect(c!.priorityExplanation).toMatch(/waiting period/);
  });

  it("writes audit entries for the batch and each new case", async () => {
    const batchAudit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: first.batch.id, action: "import.completed" } });
    expect(batchAudit.after).toMatchObject({ inserted: 7, review: 1 });
    const { caseId } = await prop("1001");
    expect(await prisma.auditLog.count({ where: { entityId: caseId!, action: "case.created" } })).toBe(1);
  });

  it("refuses to import the exact same file twice", async () => {
    await expect(
      createImportBatch({ fileName: "import-first.csv", data: fixture("import-first.csv"), source: "test", createdById: userId }),
    ).rejects.toBeInstanceOf(DuplicateFileError);
  });

  describe("second import", () => {
    let second: Awaited<ReturnType<typeof runImport>>;
    beforeAll(async () => {
      second = await runImport("import-second.csv");
    });

    it("skips properties already imported (by state property ID)", () => {
      expect(second.summary).toMatchObject({ rowCount: 3, duplicateCount: 1, insertedCount: 2 });
    });

    it("adds a new property for a known owner to that owner's open case", async () => {
      const original = await prop("1001");
      const added = await prop("2001");
      expect(added.ownerId).toBe(original.ownerId);
      expect(added.caseId).toBe(original.caseId);
      expect(await prisma.auditLog.count({ where: { entityId: original.caseId!, action: "case.properties_added" } })).toBe(1);
      const c = await prisma.case.findUniqueOrThrow({ where: { id: original.caseId! } });
      expect(c.estimatedValueCents).toBe(1_590_000);
    });

    it("a name match with no address goes to review", async () => {
      const garcia = await prop("1008");
      const noAddress = await prop("2002");
      expect(noAddress.ownerId).not.toBe(garcia.ownerId);
      const candidate = await prisma.ownerMatchCandidate.findFirstOrThrow({
        where: { newOwnerId: noAddress.ownerId!, existingOwnerId: garcia.ownerId! },
      });
      expect(JSON.stringify(candidate.reasons)).toMatch(/address missing/);
    });

    it("MERGE moves the property into the existing owner's case and records it", async () => {
      const garcia = await prop("1008");
      const noAddress = await prop("2002");
      const candidate = await prisma.ownerMatchCandidate.findFirstOrThrow({ where: { newOwnerId: noAddress.ownerId! } });
      const provisionalCaseId = noAddress.caseId!;

      await decideOwnerMatch({ candidateId: candidate.id, decision: "MERGE", actor: { id: userId, role: "OWNER" } });

      const moved = await prop("2002");
      expect(moved.ownerId).toBe(garcia.ownerId);
      expect(moved.caseId).toBe(garcia.caseId);
      expect(await prisma.case.findUnique({ where: { id: provisionalCaseId } })).toBeNull();
      const provisional = await prisma.owner.findUniqueOrThrow({ where: { id: noAddress.ownerId! } });
      expect(provisional.mergedIntoId).toBe(garcia.ownerId);
      expect((await prisma.ownerMatchCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe("MERGED");
      expect(await prisma.auditLog.count({ where: { entityId: garcia.ownerId!, action: "owner.merged" } })).toBe(1);
      const c = await prisma.case.findUniqueOrThrow({ where: { id: garcia.caseId! } });
      expect(c.estimatedValueCents).toBe(550_000);
      await expect(
        decideOwnerMatch({ candidateId: candidate.id, decision: "MERGE", actor: { id: userId, role: "OWNER" } }),
      ).rejects.toBeInstanceOf(ReviewError);
    });

    it("SEPARATE keeps both owners and closes the suggestion", async () => {
      const bill = await prop("1004");
      const william = await prop("1003");
      const candidate = await prisma.ownerMatchCandidate.findFirstOrThrow({
        where: { status: "PENDING", OR: [{ newOwnerId: bill.ownerId! }, { newOwnerId: william.ownerId! }] },
      });
      await decideOwnerMatch({ candidateId: candidate.id, decision: "SEPARATE", actor: { id: userId, role: "RESEARCHER" } });
      expect((await prisma.ownerMatchCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe("REJECTED");
      expect((await prop("1004")).ownerId).not.toBe((await prop("1003")).ownerId);
    });

    it("viewers cannot decide matches", async () => {
      await expect(
        decideOwnerMatch({ candidateId: "x", decision: "MERGE", actor: { id: userId, role: "VIEWER" } }),
      ).rejects.toThrow(/permission/);
    });
  });
});

describe("XLSX import with separate name columns", () => {
  it("reads real Excel dates and numbers", async () => {
    const parsed = await parseImportFile(readFileSync("tests/fixtures/import-parts.xlsx"), "xlsx");
    expect(parsed.headers).toContain("REMIT DATE");
    expect(parsed.rows[0]!["REMIT DATE"]).toBeInstanceOf(Date);
  });

  it("imports with first/last/middle columns and leap-day dates", async () => {
    const data = readFileSync("tests/fixtures/import-parts.xlsx");
    const batch = await createImportBatch({ fileName: "parts.xlsx", data, source: "test", createdById: userId, allowDuplicateFile: true });
    expect(batch.columnMapping).toMatchObject({
      fields: { statePropertyId: "PROPERTY_ID", ownerLastName: "LAST NAME", ownerFirstName: "FIRST NAME", ownerMiddleName: "MIDDLE" },
    });
    await prisma.property.deleteMany({ where: { statePropertyId: { in: ["700001", "700002"] } } });
    await confirmImportMapping({ batchId: batch.id, mapping: batch.columnMapping, actorId: userId, saveAs: `xlsx-layout-${RUN}` });
    const summary = await processImportBatch(batch.id, { today });
    expect(summary).toMatchObject({ insertedCount: 2, errorCount: 0 });
    const jane = await prisma.property.findFirstOrThrow({ where: { statePropertyId: "700001" }, include: { owner: true, case: true } });
    expect(jane.owner!.fullName).toBe("Jane Q Doe");
    expect(formatDateOnly(jane.dateDeliveredToState!)).toBe("2020-02-29");
    expect(jane.reportedAmountCents).toBe(880_050);
    // Feb 29 + 24 months rolls forward to Mar 1, then +1 day.
    expect(formatDateOnly(jane.case!.eligibleContractDate!)).toBe("2022-03-02");
    const roe = await prisma.property.findFirstOrThrow({ where: { statePropertyId: "700002" } });
    expect(roe.ownerAddressNormalized).toMatchObject({ line1: "PO BOX 77", isPoBox: true, zip5: "89801" });
    expect(await prisma.columnMapping.count({ where: { name: `xlsx-layout-${RUN}` } })).toBe(1);
  });
});
