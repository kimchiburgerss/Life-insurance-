/**
 * Building blocks for E2E fixtures: cases advanced through the REAL services
 * (mock providers), on the dedicated E2E database. Test setup only.
 */
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { blindIndex, encryptPii } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { addMonths, todayIn } from "@/lib/dates";
import { dispatchAgreement, simulateMockSignature } from "@/lib/agreements/gateway";
import { approveAgreement, createAgreement } from "@/lib/agreements/service";
import { assemblePacketFor, approvePacket, createPacket, recordFiling, recordOutcome, updatePacketFacts, uploadForClaimant } from "@/lib/claims/service";
import { dispatchCommunication } from "@/lib/outreach/gateway";
import { approveCommunication, createDraft } from "@/lib/outreach/service";
import { getBusinessProfile, saveBusinessProfile } from "@/lib/outreach/settings";
import { ensurePortalAccess, portalContextFromSecret, startPortalSession } from "@/lib/portal/access";
import { uploadDocument } from "@/lib/portal/service";

type RuleType = "WAITING_PERIOD" | "FEE_CAP" | "DISCLOSURE_TEXT" | "AGREEMENT_REQUIREMENTS";
const ALL_RULES: RuleType[] = ["WAITING_PERIOD", "FEE_CAP", "DISCLOSURE_TEXT", "AGREEMENT_REQUIREMENTS"];

export const newTag = () => randomUUID().slice(0, 6).toUpperCase();

export async function ownerActor() {
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } });
  return { id: owner.id, role: "OWNER" as const };
}

/** Rules must be verified to approve letters and agreements; restore what we changed. */
export async function withVerifiedRules<T>(fn: () => Promise<T>, rules: RuleType[] = ALL_RULES): Promise<T> {
  const unverified = await prisma.jurisdictionRule.findMany({ where: { stateCode: "NV", ruleType: { in: rules }, lastVerifiedAt: null }, select: { id: true } });
  const ids = unverified.map((r) => r.id);
  await prisma.jurisdictionRule.updateMany({ where: { id: { in: ids } }, data: { lastVerifiedAt: new Date(), verifiedBy: "e2e fixture" } });
  try {
    return await fn();
  } finally {
    await prisma.jurisdictionRule.updateMany({ where: { id: { in: ids } }, data: { lastVerifiedAt: null, verifiedBy: null } });
  }
}

export async function ensureBusinessProfile() {
  const actor = await ownerActor();
  if (await getBusinessProfile()) return;
  await saveBusinessProfile(actor, {
    legalName: "Demo Heir Recovery LLC",
    contactName: "Demo Owner",
    contactTitle: "Founder",
    mailingAddress: { line1: "123 Example Ave", line2: "Suite 100", city: "Las Vegas", state: "NV", zip: "89101" },
    phone: "702-555-0100",
    email: "owner@example.com",
    website: "",
  });
}

export async function fictionalPdf(text: string) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([612, 792]).drawText(`${text} (fictional, E2E)`, { x: 72, y: 700, size: 14, font: f });
  return d.save();
}

async function baseCase(prefix: string, stage: "READY_FOR_OUTREACH" | "RESPONDED", tag: string) {
  const ownerName = `${prefix === "Letter" ? "Martha L." : "Walter J."} ${prefix}${tag}`;
  const o = await prisma.owner.create({ data: { fullName: ownerName, normalizedName: ownerName.toUpperCase(), dateOfDeath: new Date("2023-06-01T00:00:00Z") } });
  const c = await prisma.case.create({
    data: {
      ownerId: o.id,
      stage,
      properties: {
        create: [
          {
            statePropertyId: `E2E-${prefix.toUpperCase()}-${tag}`,
            ownerNameRaw: `ESTATE OF ${ownerName.toUpperCase()}`,
            ownerId: o.id,
            category: "LIFE_INSURANCE",
            holderName: "RED ROCK ANNUITY & LIFE COMPANY",
            holderIsLifeInsurer: true,
            reportedAmountCents: 1_234_500,
            dateDeliveredToState: addMonths(todayIn(), -30, "rollForward"),
            rawRecord: { e2e: true },
          },
        ],
      },
    },
  });
  const ev = await prisma.evidence.create({ data: { caseId: c.id, sourceType: "OBITUARY", supportsDeath: true, title: `Obituary — ${ownerName} (fictional, E2E)` } });
  const heirName = `Dana ${prefix}${tag}`;
  const email = `dana.${prefix.toLowerCase()}.${tag.toLowerCase()}@example.com`;
  const heir = await prisma.person.create({
    data: {
      caseId: c.id, fullName: heirName, normalizedName: heirName.toUpperCase(), relationship: "CHILD", relationshipConfidence: 0.93, status: "CONFIRMED", sourceEvidenceIds: [ev.id],
      mailingAddressEnc: encryptPii(`${Math.floor(Math.random() * 9000) + 100} Cedar St, Carson City, NV 89701`), emailEnc: encryptPii(email), emailHash: blindIndex(email),
    },
  });
  return { caseId: c.id, ownerName, heirId: heir.id, heirName };
}

/** A case where the heir replied and wants help (no agreement yet). */
export const createRespondedCase = (prefix: string) => baseCase(prefix, "RESPONDED", newTag());

/** A first letter that was approved and sent (mock Lob). */
export async function createSentLetterCase(tag = newTag()) {
  await ensureBusinessProfile();
  const actor = await ownerActor();
  const b = await baseCase("Letter", "READY_FOR_OUTREACH", tag);
  const comm = await withVerifiedRules(async () => {
    const draft = await createDraft(actor, { caseId: b.caseId, personId: b.heirId, channel: "MAIL" });
    await approveCommunication(actor, draft.id, { contentHash: draft.contentHash!, confirmed: true });
    await dispatchCommunication(draft.id);
    // Delivery webhooks only apply to letters Lob printed: present this one as such.
    return prisma.communication.update({ where: { id: draft.id }, data: { provider: "lob" } });
  });
  if (comm.status !== "SENT" || !comm.providerMessageId || !comm.optOutToken) throw new Error(`fixture letter not sent: ${comm.status}`);
  return { ...b, letterId: comm.providerMessageId, optOutPath: `/u/${comm.optOutToken}` };
}

/** Agreement signed (mock e-sign); the heir uploaded and we accepted every document except the claim form. */
export async function createSignedClaimCase(prefix = "Claim", tag = newTag()) {
  const actor = await ownerActor();
  const b = await baseCase(prefix, "RESPONDED", tag);
  await withVerifiedRules(async () => {
    const a = await createAgreement(actor, { caseId: b.caseId, personId: b.heirId });
    await approveAgreement(actor, a.id, { contentHash: a.contentHash!, confirmed: true, method: "ESIGN" });
    await dispatchAgreement(a.id);
    await simulateMockSignature(a.id, b.heirId);
  });
  const access = await ensurePortalAccess(prisma, { caseId: b.caseId, personId: b.heirId });
  const portal = (await portalContextFromSecret((await startPortalSession(access.token))!.secret))!;
  for (const key of ["claimant_id", "death_certificate", "relationship_proof", "small_estate_affidavit", "affidavit_of_heirship"]) {
    await uploadDocument(portal, { checklistKey: key, fileName: `${key}.pdf`, bytes: await fictionalPdf(key) });
  }
  await acceptAll(b.caseId, actor.id);
  await prisma.portalSession.deleteMany({ where: { portalAccessId: access.id } });
  return { ...b, portalPath: `/p/${access.token}` };
}

async function acceptAll(caseId: string, ownerId: string) {
  await prisma.heirDocument.updateMany({ where: { caseId }, data: { status: "ACCEPTED", reviewedById: ownerId, reviewedAt: new Date() } });
}

/** A signed case whose packet was approved and filed online; optionally the State approved it. */
export async function createFiledClaimCase(prefix: string, opts: { stateApproved?: boolean } = {}) {
  const actor = await ownerActor();
  const s = await createSignedClaimCase(prefix);
  const packet = await createPacket(actor, { caseId: s.caseId, personId: s.heirId });
  await updatePacketFacts(actor, packet.id, { estatePath: "SMALL_ESTATE", hasWill: false });
  await uploadForClaimant(actor, packet.id, { checklistKey: "claim_form", fileName: "claim-form.pdf", bytes: await fictionalPdf("State claim form, signed by the heir") });
  await acceptAll(s.caseId, actor.id);
  await assemblePacketFor(actor, packet.id);
  const assembled = await prisma.claimPacket.findUniqueOrThrow({ where: { id: packet.id } });
  await approvePacket(actor, packet.id, { contentHash: assembled.contentHash!, confirmed: true });
  await recordFiling(actor, packet.id, { filedOn: todayIn(), method: "ONLINE", claimNumber: `NV-E2E-${prefix.toUpperCase()}` });
  if (opts.stateApproved) await recordOutcome(actor, packet.id, { outcome: "APPROVED", on: todayIn(), note: "" });
  return { ...s, packetId: packet.id };
}
