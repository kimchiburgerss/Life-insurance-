/**
 * E2E fixture: a case whose agreement was signed (through the real services,
 * mock e-sign), with the heir's documents uploaded and accepted except the
 * claim form, plus the heir's portal link. Test setup only.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { blindIndex, encryptPii } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { addMonths, todayIn } from "@/lib/dates";
import { dispatchAgreement, simulateMockSignature } from "@/lib/agreements/gateway";
import { approveAgreement, createAgreement } from "@/lib/agreements/service";
import { ensurePortalAccess, portalContextFromSecret, startPortalSession } from "@/lib/portal/access";
import { uploadDocument } from "@/lib/portal/service";

const [outFile] = process.argv.slice(2);
if (!outFile) throw new Error("usage: provision-claim-case.ts <out.json>");
const RULES = ["WAITING_PERIOD", "FEE_CAP", "DISCLOSURE_TEXT", "AGREEMENT_REQUIREMENTS"] as const;

async function pdf(text: string) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([612, 792]).drawText(`${text} (fictional, E2E)`, { x: 72, y: 700, size: 14, font: f });
  return d.save();
}

async function main() {
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } });
  const actor = { id: owner.id, role: "OWNER" as const };
  const ownerName = `Walter J. Claim${tag}`;
  const o = await prisma.owner.create({ data: { fullName: ownerName, normalizedName: ownerName.toUpperCase(), dateOfDeath: new Date("2023-06-01T00:00:00Z") } });
  const c = await prisma.case.create({
    data: {
      ownerId: o.id,
      stage: "RESPONDED",
      properties: { create: [{ statePropertyId: `E2E-CLM-${tag}`, ownerNameRaw: `ESTATE OF ${ownerName.toUpperCase()}`, ownerId: o.id, category: "LIFE_INSURANCE", holderName: "RED ROCK ANNUITY & LIFE COMPANY", reportedAmountCents: 1_234_500, dateDeliveredToState: addMonths(todayIn(), -30, "rollForward"), rawRecord: { e2e: true } }] },
    },
  });
  const ev = await prisma.evidence.create({ data: { caseId: c.id, sourceType: "OBITUARY", supportsDeath: true, title: `Obituary — ${ownerName} (fictional, E2E)` } });
  const heirName = `Dana Claim${tag}`;
  const email = `dana.${tag.toLowerCase()}@example.com`;
  const heir = await prisma.person.create({
    data: {
      caseId: c.id, fullName: heirName, normalizedName: heirName.toUpperCase(), relationship: "CHILD", relationshipConfidence: 0.93, status: "CONFIRMED", sourceEvidenceIds: [ev.id],
      mailingAddressEnc: encryptPii(`${Math.floor(Math.random() * 9000) + 100} Cedar St, Carson City, NV 89701`), emailEnc: encryptPii(email), emailHash: blindIndex(email),
    },
  });

  // Rules must be verified to approve an agreement; restore what we changed.
  const unverified = await prisma.jurisdictionRule.findMany({ where: { stateCode: "NV", ruleType: { in: [...RULES] }, lastVerifiedAt: null }, select: { id: true } });
  await prisma.jurisdictionRule.updateMany({ where: { id: { in: unverified.map((r) => r.id) } }, data: { lastVerifiedAt: new Date(), verifiedBy: "e2e fixture" } });
  try {
    const a = await createAgreement(actor, { caseId: c.id, personId: heir.id });
    await approveAgreement(actor, a.id, { contentHash: a.contentHash!, confirmed: true, method: "ESIGN" });
    await dispatchAgreement(a.id);
    await simulateMockSignature(a.id, heir.id);
  } finally {
    await prisma.jurisdictionRule.updateMany({ where: { id: { in: unverified.map((r) => r.id) } }, data: { lastVerifiedAt: null, verifiedBy: null } });
  }

  const access = await ensurePortalAccess(prisma, { caseId: c.id, personId: heir.id });
  const portal = (await portalContextFromSecret((await startPortalSession(access.token))!.secret))!;
  for (const key of ["claimant_id", "death_certificate", "relationship_proof", "small_estate_affidavit", "affidavit_of_heirship"]) {
    await uploadDocument(portal, { checklistKey: key, fileName: `${key}.pdf`, bytes: await pdf(key) });
  }
  await prisma.heirDocument.updateMany({ where: { caseId: c.id }, data: { status: "ACCEPTED", reviewedById: owner.id, reviewedAt: new Date() } });
  await prisma.portalSession.deleteMany({ where: { portalAccessId: access.id } });
  writeFileSync(outFile, JSON.stringify({ caseId: c.id, heirName, portalPath: `/p/${access.token}` }));
  console.log(`e2e: created claim case for ${ownerName}`);
}

main().finally(() => prisma.$disconnect());
