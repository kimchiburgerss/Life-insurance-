/**
 * Phase 4 outreach, end to end in mock mode: draft → checklist → approval →
 * the single send gateway → CONTACTED → follow-ups → reply/opt-out stop rules.
 * Also proves at runtime that nothing is sent without an approval of the exact
 * content (compliance rule 7) — see also tests/unit/no-send-without-approval.test.ts.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmailProvider } from "@/adapters/email/mock";
import { MockMailProvider } from "@/adapters/mail/mock";
import { ForbiddenError } from "@/lib/auth/permissions";
import { blindIndex, encryptPii } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { addDays, addMonths, todayIn } from "@/lib/dates";
import type { CaseStage, Role } from "@/lib/generated/prisma/enums";
import { applyLobEvent } from "@/lib/outreach/delivery";
import { draftDueFollowUps } from "@/lib/outreach/followups";
import { dispatchCommunication, dispatchDue, SendRefusedError } from "@/lib/outreach/gateway";
import {
  approveCommunication,
  createDraft,
  evaluateCommunication,
  logInbound,
  optOutByToken,
  OutreachError,
  rejectCommunication,
  updateDraftNote,
} from "@/lib/outreach/service";
import { saveBusinessProfile } from "@/lib/outreach/settings";
import { makeUser } from "../helpers/factories";

const today = todayIn();
let owner: { id: string; role: Role };
let researcher: { id: string; role: Role };
const RULES = ["WAITING_PERIOD", "FEE_CAP", "DISCLOSURE_TEXT"] as const;

async function readyCase(opts: { monthsAgo?: number; stage?: CaseStage; email?: string; address?: string } = {}) {
  const tag = randomUUID().slice(0, 8);
  const owner = await prisma.owner.create({ data: { fullName: `Margaret Test${tag}`, normalizedName: `MARGARET TEST${tag}`.toUpperCase() } });
  const c = await prisma.case.create({
    data: {
      ownerId: owner.id,
      stage: opts.stage ?? "READY_FOR_OUTREACH",
      properties: {
        create: [
          {
            statePropertyId: `OUT-${tag}`,
            ownerNameRaw: `ESTATE OF MARGARET TEST${tag}`,
            ownerId: owner.id,
            category: "LIFE_INSURANCE",
            holderName: "SILVER SAGE MUTUAL LIFE INSURANCE CO",
            reportedAmountCents: 1_234_567,
            dateDeliveredToState: addMonths(today, -(opts.monthsAgo ?? 30), "rollForward"),
            rawRecord: { test: true },
          },
        ],
      },
    },
  });
  const ev = await prisma.evidence.create({ data: { caseId: c.id, sourceType: "OBITUARY", supportsDeath: true, title: "Obituary (test)" } });
  const email = opts.email ?? `heir-${tag}@example.com`;
  const heir = await prisma.person.create({
    data: {
      caseId: c.id,
      fullName: `Jordan Test${tag}`,
      normalizedName: `JORDAN TEST${tag}`.toUpperCase(),
      relationship: "CHILD",
      relationshipConfidence: 0.9,
      status: "CONFIRMED",
      sourceEvidenceIds: [ev.id],
      mailingAddressEnc: encryptPii(opts.address ?? `${Math.floor(Math.random() * 9000) + 100} Oak St, Las Vegas, NV 89101`),
      emailEnc: encryptPii(email),
      emailHash: blindIndex(email),
    },
  });
  return { c, heir };
}

async function approveAndSend(commId: string) {
  const comm = await prisma.communication.findUniqueOrThrow({ where: { id: commId } });
  await approveCommunication(owner, commId, { contentHash: comm.contentHash!, confirmed: true });
  return dispatchCommunication(commId);
}

beforeAll(async () => {
  owner = { id: (await makeUser("OWNER")).user.id, role: "OWNER" };
  researcher = { id: (await makeUser("RESEARCHER")).user.id, role: "RESEARCHER" };
  await saveBusinessProfile(owner, {
    legalName: "Test Recovery LLC",
    contactName: "Pat Rivera",
    contactTitle: "",
    mailingAddress: { line1: "100 W Liberty St", line2: "", city: "Reno", state: "NV", zip: "89501" },
    phone: "775-555-0100",
    email: "pat@example.com",
    website: "",
  });
  await prisma.jurisdictionRule.updateMany({ where: { stateCode: "NV", ruleType: { in: [...RULES] } }, data: { lastVerifiedAt: new Date(), verifiedBy: "test" } });
});

afterAll(async () => {
  await prisma.jurisdictionRule.updateMany({ where: { stateCode: "NV", ruleType: { in: [...RULES] } }, data: { lastVerifiedAt: null, verifiedBy: null } });
  await prisma.$disconnect();
});

beforeEach(() => {
  MockMailProvider.sent = [];
  MockEmailProvider.sent = [];
});

describe("draft → approve → send (mock mode)", () => {
  it("drafts a compliant letter, the owner approves it, the gateway mails it and the case becomes CONTACTED", async () => {
    const { c, heir } = await readyCase();
    const draft = await createDraft(researcher, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    expect(draft.status).toBe("PENDING_APPROVAL");
    expect(draft.templateId).toBe("letter-first");
    expect(draft.textContent).toContain("We were sorry to learn of the passing of your parent");
    expect(draft.textContent).toContain("$12,345.67");

    const fresh = await prisma.communication.findUniqueOrThrow({ where: { id: draft.id } });
    const { items } = await evaluateCommunication(prisma, fresh);
    expect(items.filter((i) => i.status === "fail")).toEqual([]);
    expect(items.find((i) => i.key === "counsel")?.status).toBe("warn"); // demo mode
    expect(MockMailProvider.sent).toHaveLength(0); // drafting sends nothing

    const result = await approveAndSend(draft.id);
    expect(result.status).toBe("SENT");
    expect(MockMailProvider.sent).toHaveLength(1);
    expect(MockMailProvider.sent[0]!.html).toBe(fresh.renderedContent);
    expect(MockMailProvider.sent[0]!.idempotencyKey).toBe(draft.id);

    const sent = await prisma.communication.findUniqueOrThrow({ where: { id: draft.id } });
    expect(sent.status).toBe("SENT");
    expect(sent.providerMessageId).toMatch(/^mock_ltr_/);
    const approval = await prisma.approval.findUniqueOrThrow({ where: { id: sent.approvalId! } });
    expect(approval).toMatchObject({ decision: "APPROVED", approvedById: owner.id, contentHash: sent.contentHash, subjectId: sent.id });
    expect(approval.contentSnapshot).toContain("Free".toLowerCase());

    expect((await prisma.case.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("CONTACTED");
    const actions = (await prisma.auditLog.findMany({ where: { entityId: draft.id }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["communication.drafted", "communication.approved", "communication.sent"]);
    const personalization = await prisma.aiRun.findUniqueOrThrow({ where: { id: sent.personalizationRunId! } });
    expect(personalization.acceptance).toBe("ACCEPTED");

    // Sending again is impossible: the message is no longer APPROVED.
    await expect(dispatchCommunication(draft.id)).rejects.toBeInstanceOf(SendRefusedError);
    expect(MockMailProvider.sent).toHaveLength(1);
  });

  it("emails carry the CAN-SPAM footer and one-click unsubscribe headers", async () => {
    const { c, heir } = await readyCase();
    const draft = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "EMAIL" });
    expect((await approveAndSend(draft.id)).status).toBe("SENT");
    const sent = MockEmailProvider.sent[0]!;
    expect(sent.subject).toMatch(/^Unclaimed property in the name of /);
    expect(sent.text).toContain("This email is an offer of a paid service from Test Recovery LLC, 100 W Liberty St, Reno, NV 89501.");
    expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent.headers["List-Unsubscribe"]).toContain(`/api/unsubscribe/${draft.optOutToken}`);
  });

  it("only the OWNER approves, and only the exact content they saw", async () => {
    const { c, heir } = await readyCase();
    const draft = await createDraft(researcher, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    await expect(approveCommunication(researcher, draft.id, { contentHash: draft.contentHash!, confirmed: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveCommunication(owner, draft.id, { contentHash: draft.contentHash!, confirmed: false })).rejects.toThrow(/confirm/);

    // An edit changes the content → the hash the owner reviewed is stale.
    await updateDraftNote(researcher, draft.id, "I am sorry for your loss.");
    await expect(approveCommunication(owner, draft.id, { contentHash: draft.contentHash!, confirmed: true })).rejects.toThrow(/changed after you opened it/);
    const edited = await prisma.communication.findUniqueOrThrow({ where: { id: draft.id } });
    expect(edited.textContent).toContain("I am sorry for your loss.");
    expect(edited.contentHash).not.toBe(draft.contentHash);
    expect((edited.toneCheck as { contentHash: string }).contentHash).toBe(edited.contentHash);
    expect(MockMailProvider.sent).toHaveLength(0);
  });

  it("an edit that adds pressure wording turns the checklist red and blocks approval", async () => {
    const { c, heir } = await readyCase();
    const draft = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    await updateDraftNote(owner, draft.id, "Please act now, this is urgent!");
    const edited = await prisma.communication.findUniqueOrThrow({ where: { id: draft.id } });
    const { items } = await evaluateCommunication(prisma, edited);
    expect(items.find((i) => i.key === "banned_terms")?.status).toBe("fail");
    expect(items.find((i) => i.key === "tone")?.status).toBe("fail");
    await expect(approveCommunication(owner, draft.id, { contentHash: edited.contentHash!, confirmed: true })).rejects.toThrow(/Not every checklist item is green/);
  });

  it("rejection is recorded and the draft can never be sent", async () => {
    const { c, heir } = await readyCase();
    const draft = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    await rejectCommunication(owner, draft.id, "Wrong person");
    const r = await prisma.approval.findFirstOrThrow({ where: { subjectId: draft.id } });
    expect(r.decision).toBe("REJECTED");
    await expect(dispatchCommunication(draft.id)).rejects.toThrow(/REJECTED/);
  });

  it("no outreach during the 24-month void period", async () => {
    const { c, heir } = await readyCase({ monthsAgo: 12, stage: "WAITING_PERIOD" });
    await expect(createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" })).rejects.toThrow(/NRS 120A\.740/);
  });

  it("an unverified rule blocks approval", async () => {
    const { c, heir } = await readyCase();
    const draft = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    await prisma.jurisdictionRule.updateMany({ where: { stateCode: "NV", ruleType: "DISCLOSURE_TEXT" }, data: { lastVerifiedAt: null } });
    try {
      await expect(approveCommunication(owner, draft.id, { contentHash: draft.contentHash!, confirmed: true })).rejects.toThrow(/Rules used by this message are verified/);
    } finally {
      await prisma.jurisdictionRule.updateMany({ where: { stateCode: "NV", ruleType: "DISCLOSURE_TEXT" }, data: { lastVerifiedAt: new Date() } });
    }
  });
});

describe("rule 7: nothing is sent without an approval of the exact content", () => {
  it("the gateway refuses a message that was never approved", async () => {
    const { c, heir } = await readyCase();
    const draft = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    await expect(dispatchCommunication(draft.id)).rejects.toBeInstanceOf(SendRefusedError);
    expect(MockMailProvider.sent).toHaveLength(0);
  });

  it("the database refuses to mark a message approved/sent without a matching approval", async () => {
    const { c, heir } = await readyCase();
    const a = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    const b = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "EMAIL" });
    await expect(prisma.communication.update({ where: { id: a.id }, data: { status: "SENT" } })).rejects.toThrow(/without an approval/);
    await expect(prisma.communication.update({ where: { id: a.id }, data: { status: "APPROVED" } })).rejects.toThrow(/without an approval/);
    // An approval of a DIFFERENT message cannot be borrowed.
    const forB = await prisma.approval.create({
      data: { subjectType: "COMMUNICATION", subjectId: b.id, decision: "APPROVED", contentHash: b.contentHash!, contentSnapshot: "", approvedById: owner.id },
    });
    await expect(prisma.communication.update({ where: { id: a.id }, data: { status: "SENT", approvalId: forB.id } })).rejects.toThrow(/without an approval/);
    // A REJECTED decision is not an approval.
    const rejected = await prisma.approval.create({
      data: { subjectType: "COMMUNICATION", subjectId: a.id, decision: "REJECTED", contentHash: a.contentHash!, contentSnapshot: "", approvedById: owner.id },
    });
    await expect(prisma.communication.update({ where: { id: a.id }, data: { status: "SENT", approvalId: rejected.id } })).rejects.toThrow(/without an approval/);
    // Inserting a row that is already "sent" is refused too.
    await expect(
      prisma.communication.create({ data: { caseId: c.id, channel: "MAIL", direction: "OUTBOUND", status: "SENT", contentHash: "x" } }),
    ).rejects.toThrow(/without an approval/);
  });

  it("approved content cannot be edited afterwards, and approvals cannot be changed or deleted", async () => {
    const { c, heir } = await readyCase();
    const draft = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    const approval = await approveCommunication(owner, draft.id, { contentHash: draft.contentHash!, confirmed: true });
    await expect(prisma.communication.update({ where: { id: draft.id }, data: { renderedContent: "<p>Act now!</p>" } })).rejects.toThrow(/can no longer be edited/);
    await expect(prisma.communication.update({ where: { id: draft.id }, data: { recipientEnc: encryptPii("{}") } })).rejects.toThrow(/can no longer be edited/);
    await expect(prisma.approval.update({ where: { id: approval.id }, data: { decision: "REJECTED" } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.approval.update({ where: { id: approval.id }, data: { contentHash: "forged" } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.approval.delete({ where: { id: approval.id } })).rejects.toThrow(/cannot be deleted/);
  });

  it("the gateway refuses when the approver no longer holds the approval permission", async () => {
    const { c, heir } = await readyCase();
    const temp = await makeUser("OWNER");
    const draft = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    await approveCommunication({ id: temp.user.id, role: "OWNER" }, draft.id, { contentHash: draft.contentHash!, confirmed: true });
    await prisma.user.update({ where: { id: temp.user.id }, data: { role: "RESEARCHER" } });
    await expect(dispatchCommunication(draft.id)).rejects.toThrow(/approver is not allowed/);
    expect(MockMailProvider.sent).toHaveLength(0);
  });

  it("an opt-out between approval and sending stops the message at the gateway", async () => {
    const { c, heir } = await readyCase();
    const draft = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    await approveCommunication(owner, draft.id, { contentHash: draft.contentHash!, confirmed: true });
    await prisma.person.update({ where: { id: heir.id }, data: { doNotContact: true } });
    const r = await dispatchCommunication(draft.id);
    expect(r.status).toBe("CANCELLED");
    expect(MockMailProvider.sent).toHaveLength(0);
  });

  it("paused sending holds approved messages", async () => {
    const { c, heir } = await readyCase();
    const draft = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    await approveCommunication(owner, draft.id, { contentHash: draft.contentHash!, confirmed: true });
    await prisma.appSetting.upsert({ where: { key: "outreach_settings" }, update: { value: { sendingPaused: true } }, create: { key: "outreach_settings", value: { sendingPaused: true } } });
    try {
      expect((await dispatchCommunication(draft.id)).status).toBe("PAUSED");
      expect(MockMailProvider.sent).toHaveLength(0);
    } finally {
      await prisma.appSetting.delete({ where: { key: "outreach_settings" } });
    }
    expect((await dispatchCommunication(draft.id)).status).toBe("SENT");
  });
});

describe("do-not-contact and opt-out", () => {
  it("the opt-out link adds the person to the list for every case and cancels pending messages", async () => {
    const shared = `shared-${randomUUID().slice(0, 6)}@example.com`;
    const first = await readyCase({ email: shared });
    const sentDraft = await createDraft(owner, { caseId: first.c.id, personId: first.heir.id, channel: "EMAIL" });
    await approveAndSend(sentDraft.id);
    const pendingLetter = await createDraft(owner, { caseId: first.c.id, personId: first.heir.id, channel: "MAIL" });

    expect(await optOutByToken(sentDraft.optOutToken!)).toBe(true);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: first.heir.id } })).doNotContact).toBe(true);
    expect((await prisma.communication.findUniqueOrThrow({ where: { id: pendingLetter.id } })).status).toBe("CANCELLED");
    expect(await prisma.doNotContact.count({ where: { emailHash: blindIndex(shared) } })).toBe(1);

    // Same email on a different case (another estate): drafting is blocked.
    const second = await readyCase({ email: shared });
    await expect(createDraft(owner, { caseId: second.c.id, personId: second.heir.id, channel: "EMAIL" })).rejects.toThrow(/Do-not-contact list/);
    expect(await optOutByToken("zzzzzzzzzzzzzzzz")).toBe(false);
  });

  it("a household address on the list blocks letters to anyone at that address", async () => {
    const address = `${Math.floor(Math.random() * 9000) + 100} Pine Ave, Reno, NV 89502`;
    const first = await readyCase({ address });
    await logInbound(owner, { caseId: first.c.id, personId: first.heir.id, channel: "INBOUND_PHONE_NOTE", summary: "Please stop writing to us.", optOut: true });
    const second = await readyCase({ address: address.toUpperCase().replace("AVE", "AVENUE") });
    await expect(createDraft(owner, { caseId: second.c.id, personId: second.heir.id, channel: "MAIL" })).rejects.toThrow(/matched by mailing address/);
  });
});

describe("follow-ups (day 21 / day 45) and stop rules", () => {
  it("drafts the day-21 follow-up early, sends it only once approved and due, and stops everything on a reply", async () => {
    const { c, heir } = await readyCase();
    const first = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    await approveAndSend(first.id);
    // Sent 19 days ago at midday in Nevada (20:00 UTC) — follow-ups count Nevada days.
    await prisma.communication.update({ where: { id: first.id }, data: { sentAt: new Date(addDays(today, -19).getTime() + 20 * 3_600_000) } });

    const r = await draftDueFollowUps(today);
    expect(r.drafted).toBeGreaterThanOrEqual(1);
    const followUp = await prisma.communication.findFirstOrThrow({ where: { caseId: c.id, sequenceStep: 2 } });
    expect(followUp).toMatchObject({ status: "PENDING_APPROVAL", templateId: "letter-followup" });
    expect(followUp.scheduledFor?.toISOString().slice(0, 10)).toBe(addDays(today, 2).toISOString().slice(0, 10));
    expect(followUp.textContent).toContain("I wrote to you on");

    // Running the scheduler again does not duplicate it.
    await draftDueFollowUps(today);
    expect(await prisma.communication.count({ where: { caseId: c.id, sequenceStep: 2 } })).toBe(1);

    // Approved early → waits for its date.
    await approveCommunication(owner, followUp.id, { contentHash: followUp.contentHash!, confirmed: true });
    expect((await dispatchCommunication(followUp.id)).status).toBe("NOT_DUE");
    expect(MockMailProvider.sent).toHaveLength(1); // only the first letter
    const due = await dispatchDue(addDays(today, 3));
    expect(due.sent).toBeGreaterThanOrEqual(1);
    expect((await prisma.communication.findUniqueOrThrow({ where: { id: followUp.id } })).status).toBe("SENT");

    // Day 45 is drafted when due; a reply then cancels it and stops the sequence.
    await prisma.communication.update({ where: { id: first.id }, data: { sentAt: addDays(today, -43) } });
    await prisma.communication.update({ where: { id: followUp.id }, data: { sentAt: addDays(today, -22) } });
    await draftDueFollowUps(today);
    const finalLetter = await prisma.communication.findFirstOrThrow({ where: { caseId: c.id, sequenceStep: 3 } });
    expect(finalLetter.status).toBe("PENDING_APPROVAL");
    await logInbound(owner, { caseId: c.id, personId: heir.id, channel: "INBOUND_PHONE_NOTE", summary: "Called back, wants to know more.", optOut: false });
    expect((await prisma.communication.findUniqueOrThrow({ where: { id: finalLetter.id } })).status).toBe("CANCELLED");
    expect((await prisma.case.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("RESPONDED");
  });
});

describe("Lob delivery events", () => {
  it("marks a returned letter and cancels pending follow-up letters to that address", async () => {
    const { c, heir } = await readyCase();
    const first = await createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" });
    await approveAndSend(first.id);
    await prisma.communication.update({ where: { id: first.id }, data: { provider: "lob", providerMessageId: `ltr_${first.id}`, sentAt: addDays(today, -19) } });
    await draftDueFollowUps(today);
    const followUp = await prisma.communication.findFirstOrThrow({ where: { caseId: c.id, sequenceStep: 2 } });

    const evId = `evt_${randomUUID()}`;
    expect(await applyLobEvent({ id: evId, eventType: "letter.returned_to_sender", letterId: `ltr_${first.id}`, dateCreated: null })).toEqual({ handled: true });
    expect(await applyLobEvent({ id: evId, eventType: "letter.returned_to_sender", letterId: `ltr_${first.id}`, dateCreated: null })).toEqual({ handled: true, duplicate: true });
    // Out-of-order "processed for delivery" does not undo RETURNED.
    await applyLobEvent({ id: `evt_${randomUUID()}`, eventType: "letter.processed_for_delivery", letterId: `ltr_${first.id}`, dateCreated: null });
    expect((await prisma.communication.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("RETURNED");
    expect((await prisma.communication.findUniqueOrThrow({ where: { id: followUp.id } })).status).toBe("CANCELLED");
    expect(await prisma.notification.count({ where: { caseId: c.id, kind: "MAIL_RETURNED" } })).toBeGreaterThan(0);
    expect(await applyLobEvent({ id: "evt_x", eventType: "letter.mailed", letterId: "ltr_unknown", dateCreated: null })).toEqual({ handled: false });
  });

  it("refuses to draft for a person whose address cannot be parsed", async () => {
    const { c, heir } = await readyCase({ address: "somewhere in the desert" });
    await expect(createDraft(owner, { caseId: c.id, personId: heir.id, channel: "MAIL" })).rejects.toBeInstanceOf(OutreachError);
  });
});
