import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/permissions";
import { advanceAfterResearch, unlockDueCases } from "@/lib/case/waiting";
import { transitionCase } from "@/lib/case/transitions";
import { decryptPii } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { parseDateOnly } from "@/lib/dates";
import {
  acceptObituaryExtraction,
  acceptTracingEstimate,
  addEvidence,
  estimateTracing,
  extractObituary,
  generateResearchSummary,
  lookupContact,
  mergePersons,
  possibleDuplicates,
  ResearchError,
  saveContact,
  savePerson,
} from "@/lib/research/service";
import { forceStage, makeCase, makeUser } from "../helpers/factories";

const today = parseDateOnly("2026-11-26");
let owner: { id: string; role: "OWNER" };
let viewer: { id: string; role: "VIEWER" };

const OBIT =
  "Harold P. Winslow, 84, of Las Vegas, Nevada, passed away on March 3, 2021. He is survived by his wife, " +
  "Margaret Winslow; his son, David Winslow; and his daughter, Ellen Brooks. He was preceded in death by his " +
  "brother, Frank Winslow. Memorial gifts to the VFW; family SSN on file 123-45-6789 should never be stored.";

async function caseForHarold(delivered: Date) {
  const c = await makeCase([delivered]);
  await prisma.owner.update({
    where: { id: c.ownerId },
    data: { fullName: "Harold P Winslow", normalizedName: "HAROLD P WINSLOW", lastKnownAddresses: [{ city: "LAS VEGAS", state: "NV", zip5: "89102" }] },
  });
  return c;
}

beforeAll(async () => {
  owner = { id: (await makeUser("OWNER")).user.id, role: "OWNER" };
  viewer = { id: (await makeUser("VIEWER")).user.id, role: "VIEWER" };
});
afterAll(() => prisma.$disconnect());

describe("AI-assisted death verification and heir research (mock mode)", () => {
  it("records an AI run as a redacted, pending suggestion", async () => {
    const c = await caseForHarold(parseDateOnly("2022-04-12"));
    const ev = await addEvidence(owner, { caseId: c.id, sourceType: "OBITUARY", title: "Obituary", url: "https://obituaries.example.com/h", rawText: OBIT, supportsDeath: false });
    const r = await extractObituary(owner, ev.id);
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(run).toMatchObject({ promptName: "obituary-extraction", promptVersion: "1", model: "mock", status: "SUCCEEDED", acceptance: "PENDING", costMicros: 0, caseId: c.id });
    expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(run.inputRedacted)).toContain("[REDACTED-SSN]");
    expect(JSON.stringify(run.inputRedacted)).not.toContain("123-45-6789");
    expect(r.output.relatives.map((x) => `${x.name}:${x.relationship}:${x.status}`)).toEqual([
      "Frank Winslow:SIBLING:PREDECEASED",
      "Margaret Winslow:SPOUSE:SURVIVING",
      "David Winslow:CHILD:SURVIVING",
      "Ellen Brooks:CHILD:SURVIVING",
    ]);
    // Nothing changed on the case yet.
    expect(await prisma.person.count({ where: { caseId: c.id } })).toBe(0);
    expect((await prisma.evidence.findUniqueOrThrow({ where: { id: ev.id } })).supportsDeath).toBe(false);
  });

  it("accepting creates heir candidates, confirms death, and unlocks the next stage", async () => {
    const c = await caseForHarold(parseDateOnly("2022-04-12"));
    await forceStage(c.id, "SCREENED");
    const ev = await addEvidence(owner, { caseId: c.id, sourceType: "OBITUARY", title: "Obituary", rawText: OBIT, supportsDeath: false });
    const r = await extractObituary(owner, ev.id);
    await expect(transitionCase({ caseId: c.id, to: "OWNER_VERIFIED_DECEASED", actor: { type: "USER", ...owner }, today })).rejects.toThrow(/cited source/);

    const res = await acceptObituaryExtraction(owner, { aiRunId: r.runId, confirmsOwnerDeath: true, relativeIndexes: [0, 1, 2, 3] });
    expect(res.created).toHaveLength(4);
    const people = await prisma.person.findMany({ where: { caseId: c.id }, orderBy: { fullName: "asc" } });
    expect(people.map((p) => [p.fullName, p.relationship, p.status, p.isPredeceased])).toEqual([
      ["David Winslow", "CHILD", "CANDIDATE", false],
      ["Ellen Brooks", "CHILD", "CANDIDATE", false],
      ["Frank Winslow", "SIBLING", "CANDIDATE", true],
      ["Margaret Winslow", "SPOUSE", "CANDIDATE", false],
    ]);
    expect(people.every((p) => p.sourceEvidenceIds.includes(ev.id))).toBe(true);
    const o = await prisma.owner.findUniqueOrThrow({ where: { id: c.ownerId } });
    expect(o.deathVerified).toBe(true);
    expect(o.dateOfDeath?.toISOString().slice(0, 10)).toBe("2021-03-03");
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: r.runId } })).acceptance).toBe("ACCEPTED");
    expect(await prisma.auditLog.count({ where: { entityId: c.id, action: "research.obituary_accepted" } })).toBe(1);

    await expect(transitionCase({ caseId: c.id, to: "OWNER_VERIFIED_DECEASED", actor: { type: "USER", ...owner }, today })).resolves.toBeTruthy();
    await expect(acceptObituaryExtraction(owner, { aiRunId: r.runId, confirmsOwnerDeath: true, relativeIndexes: [] })).rejects.toThrow(/already been decided/);

    // A second obituary naming the same people links to them instead of duplicating.
    const ev2 = await addEvidence(owner, { caseId: c.id, sourceType: "OBITUARY", title: "Newspaper notice", rawText: OBIT, supportsDeath: false });
    const r2 = await extractObituary(owner, ev2.id);
    const res2 = await acceptObituaryExtraction(owner, { aiRunId: r2.runId, confirmsOwnerDeath: false, relativeIndexes: [1, 2] });
    expect(res2).toEqual({ created: [], linked: expect.any(Array) });
    expect(await prisma.person.count({ where: { caseId: c.id } })).toBe(4);
  });

  it("viewers can't add evidence; bad links are refused", async () => {
    const c = await caseForHarold(parseDateOnly("2022-04-12"));
    await expect(addEvidence(viewer, { caseId: c.id, sourceType: "OBITUARY", title: "x", supportsDeath: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addEvidence(owner, { caseId: c.id, sourceType: "OBITUARY", title: "x", url: "javascript:alert(1)", supportsDeath: false })).rejects.toBeInstanceOf(ResearchError);
  });

  it("finds possible duplicate people and merges them on request", async () => {
    const c = await caseForHarold(parseDateOnly("2022-04-12"));
    const base = { isPredeceased: false, parentPersonId: null, relationshipConfidence: 0.7, status: "CANDIDATE" as const, notes: null };
    const a = await savePerson(owner, c.id, null, { ...base, fullName: "Katherine Doyle", relationship: "CHILD" });
    const b = await savePerson(owner, c.id, null, { ...base, fullName: "Kathy Doyle", relationship: "CHILD" });
    await savePerson(owner, c.id, null, { ...base, fullName: "Mario Bianchi", relationship: "SIBLING" });
    const dups = await possibleDuplicates(c.id);
    expect(dups).toHaveLength(1);
    expect([dups[0]!.a.fullName, dups[0]!.b.fullName].sort()).toEqual(["Katherine Doyle", "Kathy Doyle"]);
    await mergePersons(owner, c.id, a.id, b.id);
    expect(await prisma.person.findUnique({ where: { id: b.id } })).toBeNull();
  });

  it("contact lookup needs a permissible purpose; saved contact is encrypted and audit has no PII", async () => {
    const c = await caseForHarold(parseDateOnly("2022-04-12"));
    const person = await savePerson(owner, c.id, null, {
      fullName: "Ellen Brooks", relationship: "CHILD", isPredeceased: false, parentPersonId: null, relationshipConfidence: 0.8, status: "CONFIRMED", notes: null,
    });
    await expect(lookupContact(owner, person.id, false)).rejects.toThrow(/permissible purpose/);
    const { matches } = await lookupContact(owner, person.id, true);
    expect(matches[0]!.email).toMatch(/@example\.com$/);
    await saveContact(owner, person.id, {
      address: matches[0]!.address, phone: matches[0]!.phone, email: matches[0]!.email, source: "VENDOR", sourceDetail: "mock vendor", vendorRecordId: matches[0]!.vendorRecordId,
    });
    const p = await prisma.person.findUniqueOrThrow({ where: { id: person.id } });
    expect(p.mailingAddressEnc).toMatch(/^v1:/);
    expect(decryptPii(p.emailEnc!)).toBe(matches[0]!.email);
    const ev = await prisma.evidence.findFirstOrThrow({ where: { personId: person.id, sourceType: "PEOPLE_SEARCH_VENDOR" } });
    expect(JSON.stringify(ev.extractedFacts)).not.toContain(matches[0]!.email!);
    const audits = await prisma.auditLog.findMany({ where: { entityId: person.id } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["contact.lookup", "contact.saved"]));
    const logged = JSON.stringify(audits.map((a) => [a.before, a.after, a.reason]));
    expect(logged).not.toContain(matches[0]!.email!);
    expect(logged).not.toContain(matches[0]!.address!);
  });

  it("research summary and tracing estimate are suggestions; an accepted estimate changes the score", async () => {
    const c = await caseForHarold(parseDateOnly("2022-04-12"));
    const s = await generateResearchSummary(owner, c.id);
    expect(s.output.uncertain.join(" ")).toMatch(/No source confirms the owner's death/);
    const t = await estimateTracing(owner, c.id);
    await acceptTracingEstimate(owner, t.runId);
    const after = await prisma.case.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.tracingAssessment).toMatchObject({ difficulty: t.output.difficulty, aiRunId: t.runId });
    expect(JSON.stringify(after.priorityFactors)).toMatch(/AI tracing estimate/);
  });
});

describe("waiting-period manager", () => {
  it("moves a researched case into WAITING_PERIOD while the void period runs", async () => {
    const c = await caseForHarold(parseDateOnly("2025-09-01")); // eligible 2027-09-02
    await forceStage(c.id, "HEIRS_IDENTIFIED");
    expect(await advanceAfterResearch(c.id, today)).toEqual({ moved: "WAITING_PERIOD" });
    const after = await prisma.case.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.stage).toBe("WAITING_PERIOD");
    expect(after.eligibleContractDate?.toISOString().slice(0, 10)).toBe("2027-09-02");
  });

  it("nightly unlock is blocked (and reported) while the rule is unverified, then unlocks once verified", async () => {
    const c = await caseForHarold(parseDateOnly("2024-01-10")); // eligible 2026-01-11
    await prisma.case.update({ where: { id: c.id }, data: { assignedUserId: owner.id } });
    await forceStage(c.id, "WAITING_PERIOD");
    await prisma.case.update({ where: { id: c.id }, data: { eligibleContractDate: parseDateOnly("2026-01-11") } });

    const blocked = await unlockDueCases(today);
    expect(blocked.blocked).toBeGreaterThanOrEqual(1);
    expect((await prisma.case.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("WAITING_PERIOD");
    const note = await prisma.notification.findFirstOrThrow({ where: { caseId: c.id, userId: owner.id, kind: "UNLOCK_BLOCKED" } });
    expect(note.body).toMatch(/not been verified/);
    await unlockDueCases(today); // same blocked notice is not repeated while unread
    expect(await prisma.notification.count({ where: { caseId: c.id, userId: owner.id, kind: "UNLOCK_BLOCKED" } })).toBe(1);

    await prisma.jurisdictionRule.updateMany({ where: { stateCode: "NV", ruleType: "WAITING_PERIOD" }, data: { lastVerifiedAt: new Date(), verifiedBy: "test" } });
    try {
      const r = await unlockDueCases(today);
      expect(r.unlocked).toBeGreaterThanOrEqual(1);
      expect((await prisma.case.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("READY_FOR_OUTREACH");
      expect(await prisma.notification.count({ where: { caseId: c.id, kind: "CASE_UNLOCKED" } })).toBeGreaterThanOrEqual(1);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: c.id, action: "case.stage_changed" }, orderBy: { id: "desc" } });
      expect(audit).toMatchObject({ actorType: "SYSTEM", actorId: "job:waiting-period" });
    } finally {
      await prisma.jurisdictionRule.updateMany({ where: { stateCode: "NV", ruleType: "WAITING_PERIOD" }, data: { lastVerifiedAt: null, verifiedBy: null } });
    }
  });

  it("does not unlock early", async () => {
    const c = await caseForHarold(parseDateOnly("2025-09-01"));
    await forceStage(c.id, "WAITING_PERIOD");
    await prisma.case.update({ where: { id: c.id }, data: { eligibleContractDate: parseDateOnly("2027-09-02") } });
    await unlockDueCases(today);
    expect((await prisma.case.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("WAITING_PERIOD");
  });
});
