/**
 * E2E fixture: a fresh case that is past the 24-month void period, with a cited
 * death source and a confirmed heir who has a mailing address, at
 * READY_FOR_OUTREACH. Test setup only — it writes directly to the database.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { encryptPii } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { addMonths, todayIn } from "@/lib/dates";
import { getBusinessProfile, saveBusinessProfile } from "@/lib/outreach/settings";

const [outFile] = process.argv.slice(2);
if (!outFile) throw new Error("usage: provision-outreach-case.ts <out.json>");

async function main() {
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const ownerUser = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } });
  if (!(await getBusinessProfile())) {
    await saveBusinessProfile(
      { id: ownerUser.id, role: "OWNER" },
      {
        legalName: "Demo Heir Recovery LLC",
        contactName: "Demo Owner",
        contactTitle: "Founder",
        mailingAddress: { line1: "123 Example Ave", line2: "Suite 100", city: "Las Vegas", state: "NV", zip: "89101" },
        phone: "702-555-0100",
        email: "owner@example.com",
        website: "",
      },
    );
  }
  const ownerName = `Evelyn Q. Outreach${tag}`;
  const owner = await prisma.owner.create({ data: { fullName: ownerName, normalizedName: ownerName.toUpperCase() } });
  const c = await prisma.case.create({
    data: {
      ownerId: owner.id,
      stage: "READY_FOR_OUTREACH",
      estimatedValueCents: 482_219,
      properties: {
        create: [
          {
            statePropertyId: `E2E-OUT-${tag}`,
            ownerNameRaw: `ESTATE OF ${ownerName.toUpperCase()}`,
            ownerId: owner.id,
            category: "LIFE_INSURANCE",
            holderName: "SILVER SAGE MUTUAL LIFE INSURANCE CO",
            holderIsLifeInsurer: true,
            reportedAmountCents: 482_219,
            dateDeliveredToState: addMonths(todayIn(), -30, "rollForward"),
            rawRecord: { e2e: true },
          },
        ],
      },
    },
  });
  const ev = await prisma.evidence.create({
    data: { caseId: c.id, sourceType: "OBITUARY", supportsDeath: true, title: `Obituary — ${ownerName} (fictional, E2E)` },
  });
  const heirName = `Riley Outreach${tag}`;
  await prisma.person.create({
    data: {
      caseId: c.id,
      fullName: heirName,
      normalizedName: heirName.toUpperCase(),
      relationship: "CHILD",
      relationshipConfidence: 0.92,
      status: "CONFIRMED",
      sourceEvidenceIds: [ev.id],
      mailingAddressEnc: encryptPii(`${Math.floor(Math.random() * 9000) + 100} Juniper Ln, Henderson, NV 89052`),
    },
  });
  writeFileSync(outFile, JSON.stringify({ caseId: c.id, ownerName, heirName }));
  console.log(`e2e: created outreach case for ${ownerName}`);
}

main().finally(() => prisma.$disconnect());
