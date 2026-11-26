import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/permissions";
import { TransitionError, transitionCase } from "@/lib/case/transitions";
import { prisma } from "@/lib/db";
import { formatDateOnly, parseDateOnly } from "@/lib/dates";
import { addDeathEvidence, addQualifiedHeir, forceStage, makeCase, makeUser } from "../helpers/factories";

const today = parseDateOnly("2026-11-26");
let owner: { type: "USER"; id: string; role: "OWNER" };
let researcher: { type: "USER"; id: string; role: "RESEARCHER" };
let viewer: { type: "USER"; id: string; role: "VIEWER" };

beforeAll(async () => {
  owner = { type: "USER", id: (await makeUser("OWNER")).user.id, role: "OWNER" };
  researcher = { type: "USER", id: (await makeUser("RESEARCHER")).user.id, role: "RESEARCHER" };
  viewer = { type: "USER", id: (await makeUser("VIEWER")).user.id, role: "VIEWER" };
});
afterAll(() => prisma.$disconnect());

describe("transitionCase", () => {
  it("moves a case, stores eligibility, and appends an audit entry atomically", async () => {
    const c = await makeCase([parseDateOnly("2024-01-15")]);
    const r = await transitionCase({ caseId: c.id, to: "SCREENED", actor: researcher, today });
    expect(r).toMatchObject({ from: "IMPORTED", to: "SCREENED" });
    const after = await prisma.case.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.stage).toBe("SCREENED");
    expect(formatDateOnly(after.eligibleContractDate!)).toBe("2026-01-16");
    const audit = await prisma.auditLog.findMany({ where: { entityId: c.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "case.stage_changed", actorId: researcher.id });
    expect(audit[0]!.before).toEqual({ stage: "IMPORTED" });
  });

  it("rejects edges outside the pipeline", async () => {
    const c = await makeCase([parseDateOnly("2020-01-01")]);
    await expect(transitionCase({ caseId: c.id, to: "CONTACTED", actor: owner, today })).rejects.toThrow(
      /not part of the case pipeline/,
    );
  });

  it("requires a death source before OWNER_VERIFIED_DECEASED", async () => {
    const c = await makeCase([parseDateOnly("2020-01-01")]);
    await forceStage(c.id, "SCREENED");
    await expect(
      transitionCase({ caseId: c.id, to: "OWNER_VERIFIED_DECEASED", actor: owner, today }),
    ).rejects.toBeInstanceOf(TransitionError);
    await addDeathEvidence(c.id);
    await expect(
      transitionCase({ caseId: c.id, to: "OWNER_VERIFIED_DECEASED", actor: owner, today }),
    ).resolves.toMatchObject({ to: "OWNER_VERIFIED_DECEASED" });
  });

  it("enforces roles: viewers can't move cases; researchers can't start outreach", async () => {
    const c = await makeCase([parseDateOnly("2020-01-01")]);
    await expect(transitionCase({ caseId: c.id, to: "SCREENED", actor: viewer, today })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await forceStage(c.id, "WAITING_PERIOD");
    await expect(
      transitionCase({ caseId: c.id, to: "READY_FOR_OUTREACH", actor: researcher, today }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks outreach during the 24-month void period, even for the OWNER with an override", async () => {
    const c = await makeCase([parseDateOnly("2025-06-01")]); // eligible 2027-06-02
    const e = await addDeathEvidence(c.id);
    await addQualifiedHeir(c.id, e.id);
    await forceStage(c.id, "WAITING_PERIOD");
    const attempt = transitionCase({
      caseId: c.id,
      to: "READY_FOR_OUTREACH",
      actor: owner,
      today,
      override: true,
      reason: "Trying to override the statute (should fail)",
    });
    await expect(attempt).rejects.toMatchObject({
      blocks: expect.arrayContaining([expect.objectContaining({ code: "VOID_PERIOD_NOT_ELAPSED" })]),
    });
    expect((await prisma.case.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("WAITING_PERIOD");
  });

  it("unverified rule: blocked without override; OWNER override needs a real reason and is logged", async () => {
    const c = await makeCase([parseDateOnly("2023-01-01")]); // eligible 2025-01-02
    await forceStage(c.id, "WAITING_PERIOD");
    await expect(transitionCase({ caseId: c.id, to: "READY_FOR_OUTREACH", actor: owner, today })).rejects.toMatchObject({
      blocks: [expect.objectContaining({ code: "RULE_UNVERIFIED" })],
    });
    await expect(
      transitionCase({ caseId: c.id, to: "READY_FOR_OUTREACH", actor: owner, today, override: true, reason: "ok" }),
    ).rejects.toThrow(/written reason/);
    await expect(
      transitionCase({
        caseId: c.id,
        to: "READY_FOR_OUTREACH",
        actor: researcher,
        today,
        override: true,
        reason: "Researcher attempting override",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const r = await transitionCase({
      caseId: c.id,
      to: "READY_FOR_OUTREACH",
      actor: owner,
      today,
      override: true,
      reason: "Verified 24-month rule by phone with the Division on 2026-11-20",
    });
    expect(r.overridden.map((b) => b.code)).toEqual(["RULE_UNVERIFIED"]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: c.id }, orderBy: { id: "desc" } });
    expect(audit.action).toBe("case.stage_changed.override");
    expect(audit.reason).toMatch(/Verified 24-month rule/);
    expect(audit.after).toMatchObject({ overriddenBlocks: ["RULE_UNVERIFIED"] });
  });

  it("once the rule is verified, an eligible case moves without override", async () => {
    await prisma.jurisdictionRule.updateMany({
      where: { stateCode: "NV", ruleType: "WAITING_PERIOD" },
      data: { lastVerifiedAt: new Date(), verifiedBy: "test" },
    });
    try {
      const c = await makeCase([parseDateOnly("2023-01-01")]);
      await forceStage(c.id, "WAITING_PERIOD");
      await expect(transitionCase({ caseId: c.id, to: "READY_FOR_OUTREACH", actor: owner, today })).resolves.toMatchObject({
        overridden: [],
      });
    } finally {
      await prisma.jurisdictionRule.updateMany({
        where: { stateCode: "NV", ruleType: "WAITING_PERIOD" },
        data: { lastVerifiedAt: null, verifiedBy: null },
      });
    }
  });

  it("CONTACTED is impossible without an approved, sent letter — no override", async () => {
    const c = await makeCase([parseDateOnly("2022-01-01")]);
    await forceStage(c.id, "READY_FOR_OUTREACH");
    await expect(
      transitionCase({
        caseId: c.id,
        to: "CONTACTED",
        actor: owner,
        today,
        override: true,
        reason: "Attempting to mark contacted with no approved letter",
      }),
    ).rejects.toMatchObject({
      blocks: expect.arrayContaining([expect.objectContaining({ code: "NO_APPROVED_OUTREACH_SENT" })]),
    });
  });

  it("an unknown delivery date blocks outreach (overridable by OWNER with reason)", async () => {
    const c = await makeCase([null]);
    await forceStage(c.id, "WAITING_PERIOD");
    await expect(transitionCase({ caseId: c.id, to: "READY_FOR_OUTREACH", actor: owner, today })).rejects.toMatchObject({
      blocks: expect.arrayContaining([expect.objectContaining({ code: "DELIVERY_DATE_UNKNOWN" })]),
    });
  });
});
