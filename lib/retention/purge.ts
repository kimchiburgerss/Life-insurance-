/**
 * Data retention (SECURITY.md, ASSUMPTIONS.md "Data retention"). Runs nightly.
 *
 * | When                                   | What is removed                                                |
 * |----------------------------------------|----------------------------------------------------------------|
 * | 180 days after a case closes *lost*    | heirs' contact details, heir messages, portal links, uploaded documents and claim packets |
 * | 2 years after a case closes *won*      | uploaded documents and claim packets                           |
 * | 7 years after any case closes          | everything above, plus agreement PDFs and signed copies        |
 *
 * Kept: names, relationships and research notes on the case record, the
 * append-only audit log (PII is redacted when written), invoices and amounts
 * (financial records for 7 years), and the do-not-contact list (hashes only,
 * so an opt-out is honoured forever).
 *
 * Files are purged in place (bytes emptied, `purgedAt` set) so approval
 * records that reference them stay intact.
 */
import "server-only";
import type { CaseStage } from "@/lib/generated/prisma/client";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

const DAY = 86_400_000;
const days = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 30 ? n : fallback;
};

export const RETENTION = {
  lostContactDays: days("RETENTION_LOST_CASE_DAYS", 180),
  wonDocumentDays: days("RETENTION_WON_DOCUMENT_DAYS", 730),
  recordDays: days("RETENTION_RECORD_DAYS", 7 * 365 + 2),
};

const LOST: CaseStage[] = ["CLOSED_NO_HEIR", "CLOSED_DECLINED", "CLOSED_SELF_CLAIMED", "CLOSED_INELIGIBLE"];
const HEIR_FILES = ["HEIR_UPLOAD", "CLAIM_PACKET"];
const REMOVED = "[Removed under the data-retention policy]";
const SYSTEM = { type: "SYSTEM" as const, id: "retention" };

export type RetentionReport = { contactPurgedPeople: number; filesPurged: number; messagesCleared: number; portalLinksRevoked: number; cases: number };

async function closedBefore(stages: CaseStage[] | null, cutoff: Date): Promise<string[]> {
  const rows = await prisma.case.findMany({
    where: { closedAt: { lt: cutoff }, ...(stages ? { stage: { in: stages } } : { stage: { in: [...LOST, "CLOSED_WON"] } }) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Contact details, heir-written messages and portal access for every heir on these cases. */
async function purgeContacts(caseIds: string[], now: Date, dryRun: boolean) {
  const people = await prisma.person.findMany({
    where: { caseId: { in: caseIds }, OR: [{ piiPurgedAt: null }, { emailEnc: { not: null } }, { phoneEnc: { not: null } }, { mailingAddressEnc: { not: null } }] },
    select: { id: true, caseId: true },
  });
  const ids = people.map((p) => p.id);
  if (!ids.length) return { people: 0, messages: 0, links: 0, byCase: new Map<string, number>() };
  const byCase = new Map<string, number>();
  for (const p of people) byCase.set(p.caseId, (byCase.get(p.caseId) ?? 0) + 1);
  if (dryRun) {
    const messages = await prisma.communication.count({ where: { personId: { in: ids }, direction: "INBOUND", textContent: { not: REMOVED } } });
    const links = await prisma.portalAccess.count({ where: { personId: { in: ids }, revokedAt: null } });
    return { people: ids.length, messages, links, byCase };
  }
  return prisma.$transaction(async (tx) => {
    await tx.person.updateMany({ where: { id: { in: ids } }, data: { emailEnc: null, phoneEnc: null, mailingAddressEnc: null, emailHash: null, notes: null, piiPurgedAt: now } });
    // Approved outbound messages may only have their recipient cleared (database trigger).
    await tx.communication.updateMany({ where: { personId: { in: ids }, recipientEnc: { not: null } }, data: { recipientEnc: null } });
    const messages = await tx.communication.updateMany({
      where: { personId: { in: ids }, direction: "INBOUND", OR: [{ textContent: { not: REMOVED } }, { textContent: null }] },
      data: { textContent: REMOVED, renderedContent: null, subject: null },
    });
    const links = await tx.portalAccess.updateMany({ where: { personId: { in: ids }, revokedAt: null }, data: { revokedAt: now } });
    await tx.portalSession.deleteMany({ where: { portalAccess: { personId: { in: ids } } } });
    return { people: ids.length, messages: messages.count, links: links.count, byCase };
  });
}

async function purgeFiles(caseIds: string[], kinds: string[] | null, now: Date, dryRun: boolean) {
  const where = { caseId: { in: caseIds }, purgedAt: null, ...(kinds ? { kind: { in: kinds } } : {}) };
  if (dryRun) return prisma.storedFile.count({ where });
  const r = await prisma.storedFile.updateMany({ where, data: { data: new Uint8Array(0), purgedAt: now } });
  return r.count;
}

export async function runRetention(now = new Date(), opts: { dryRun?: boolean } = {}): Promise<RetentionReport> {
  const dryRun = opts.dryRun ?? false;
  const lost = await closedBefore(LOST, new Date(now.getTime() - RETENTION.lostContactDays * DAY));
  const won = await closedBefore(["CLOSED_WON"], new Date(now.getTime() - RETENTION.wonDocumentDays * DAY));
  const old = await closedBefore(null, new Date(now.getTime() - RETENTION.recordDays * DAY));

  const report: RetentionReport = { contactPurgedPeople: 0, filesPurged: 0, messagesCleared: 0, portalLinksRevoked: 0, cases: 0 };
  const touched = new Map<string, { people: number; files: number }>();
  const note = (caseId: string, people: number, files: number) => {
    const t = touched.get(caseId) ?? { people: 0, files: 0 };
    touched.set(caseId, { people: t.people + people, files: t.files + files });
  };

  const contactCases = [...new Set([...lost, ...old])];
  const c = await purgeContacts(contactCases, now, dryRun);
  report.contactPurgedPeople = c.people;
  report.messagesCleared = c.messages;
  report.portalLinksRevoked = c.links;
  for (const [caseId, n] of c.byCase) note(caseId, n, 0);

  for (const [ids, kinds] of [[[...new Set([...lost, ...won])], HEIR_FILES], [old, null]] as const) {
    for (const caseId of ids) {
      const n = await purgeFiles([caseId], kinds ? [...kinds] : null, now, dryRun);
      if (n) note(caseId, 0, n);
      report.filesPurged += n;
    }
  }

  report.cases = touched.size;
  if (!dryRun) {
    for (const [caseId, t] of touched) {
      await writeAudit(prisma, { actor: SYSTEM, action: "retention.purged", entityType: "Case", entityId: caseId, after: { peopleContactPurged: t.people, filesPurged: t.files } });
    }
  }
  return report;
}
