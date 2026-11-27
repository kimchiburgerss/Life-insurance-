import { afterAll, describe, expect, it } from "vitest";
import type { CaseStage } from "@/lib/generated/prisma/client";
import { encryptPii } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { readFile, saveFile } from "@/lib/files/storage";
import { ensurePortalAccess } from "@/lib/portal/access";
import { runRetention } from "@/lib/retention/purge";
import { makeCase, makeUser } from "../helpers/factories";

afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;

async function closedCase(stage: CaseStage, closedDaysAgo: number) {
  const { user } = await makeUser("OWNER", { totp: false });
  const c = await makeCase([new Date("2020-01-15T00:00:00Z")]);
  await prisma.case.update({ where: { id: c.id }, data: { stage, closedAt: new Date(Date.now() - closedDaysAgo * DAY) } });
  const person = await prisma.person.create({
    data: {
      caseId: c.id, fullName: "Rowan Retain", normalizedName: "ROWAN RETAIN", relationship: "CHILD", status: "CONFIRMED", notes: "Called 702-555-0100",
      emailEnc: encryptPii("rowan@example.com"), phoneEnc: encryptPii("702-555-0100"), mailingAddressEnc: encryptPii("1 Elm St, Reno, NV 89501"),
    },
  });
  await prisma.communication.create({ data: { caseId: c.id, personId: person.id, channel: "EMAIL", direction: "INBOUND", status: "RECEIVED", textContent: "My new number is 702-555-0199" } });
  await prisma.communication.create({ data: { caseId: c.id, personId: person.id, channel: "MAIL", direction: "OUTBOUND", status: "DRAFT", recipientEnc: encryptPii("{\"name\":\"Rowan\"}") } });
  const bytes = new TextEncoder().encode("%PDF-1.4 fictional");
  const file = (kind: "HEIR_UPLOAD" | "CLAIM_PACKET" | "AGREEMENT_SIGNED") => saveFile(prisma, { caseId: c.id, kind, fileName: `${kind}.pdf`, contentType: "application/pdf", bytes, uploadedBy: user.id });
  const files = { upload: await file("HEIR_UPLOAD"), packet: await file("CLAIM_PACKET"), agreement: await file("AGREEMENT_SIGNED") };
  const access = await ensurePortalAccess(prisma, { caseId: c.id, personId: person.id });
  return { c, person, files, accessId: access.id };
}

async function state(s: Awaited<ReturnType<typeof closedCase>>) {
  const p = await prisma.person.findUniqueOrThrow({ where: { id: s.person.id } });
  const inbound = await prisma.communication.findFirstOrThrow({ where: { personId: s.person.id, direction: "INBOUND" } });
  const outbound = await prisma.communication.findFirstOrThrow({ where: { personId: s.person.id, direction: "OUTBOUND" } });
  const access = await prisma.portalAccess.findUniqueOrThrow({ where: { id: s.accessId } });
  return {
    contact: Boolean(p.emailEnc || p.phoneEnc || p.mailingAddressEnc || p.notes),
    purgedAt: p.piiPurgedAt,
    name: p.fullName,
    inbound: inbound.textContent,
    recipient: outbound.recipientEnc,
    portalRevoked: Boolean(access.revokedAt),
    upload: Boolean(await readFile(s.files.upload.id)),
    packet: Boolean(await readFile(s.files.packet.id)),
    agreement: Boolean(await readFile(s.files.agreement.id)),
  };
}

describe("data retention", () => {
  it("purges on schedule: lost cases after 180 days, won-case documents after 2 years, everything after 7 years", async () => {
    const lostOld = await closedCase("CLOSED_DECLINED", 200);
    const lostRecent = await closedCase("CLOSED_NO_HEIR", 30);
    const wonRecent = await closedCase("CLOSED_WON", 365);
    const wonOld = await closedCase("CLOSED_WON", 3 * 365);
    const wonAncient = await closedCase("CLOSED_WON", 8 * 365);

    const preview = await runRetention(new Date(), { dryRun: true });
    expect(preview.cases).toBeGreaterThanOrEqual(3);
    expect((await state(lostOld)).contact).toBe(true); // dry run changes nothing

    const report = await runRetention();
    expect(report.contactPurgedPeople).toBeGreaterThanOrEqual(2);

    expect(await state(lostOld)).toMatchObject({ contact: false, name: "Rowan Retain", inbound: "[Removed under the data-retention policy]", recipient: null, portalRevoked: true, upload: false, packet: false, agreement: true });
    expect((await state(lostOld)).purgedAt).not.toBeNull();
    expect(await state(lostRecent)).toMatchObject({ contact: true, portalRevoked: false, upload: true, packet: true, agreement: true });
    expect(await state(wonRecent)).toMatchObject({ contact: true, upload: true, packet: true, agreement: true });
    expect(await state(wonOld)).toMatchObject({ contact: true, upload: false, packet: false, agreement: true });
    expect(await state(wonAncient)).toMatchObject({ contact: false, upload: false, packet: false, agreement: false });

    const audit = await prisma.auditLog.findFirst({ where: { action: "retention.purged", entityId: lostOld.c.id } });
    expect(audit?.after).toMatchObject({ peopleContactPurged: 1, filesPurged: 2 });

    // Idempotent: a second run finds nothing more for these cases.
    await runRetention();
    expect(await prisma.auditLog.count({ where: { action: "retention.purged", entityId: lostOld.c.id } })).toBe(1);
  });
});
