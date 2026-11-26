/**
 * E2E fixture: a case at RESPONDED (past the void period, exact amount), a
 * confirmed heir with address and email, and the heir's portal link.
 * Test setup only — it writes directly to the database.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { blindIndex, encryptPii } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { addMonths, todayIn } from "@/lib/dates";
import { ensurePortalAccess } from "@/lib/portal/access";

const [outFile] = process.argv.slice(2);
if (!outFile) throw new Error("usage: provision-agreement-case.ts <out.json>");

async function main() {
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const ownerName = `Harold P. Agree${tag}`;
  const owner = await prisma.owner.create({ data: { fullName: ownerName, normalizedName: ownerName.toUpperCase() } });
  const c = await prisma.case.create({
    data: {
      ownerId: owner.id,
      stage: "RESPONDED",
      estimatedValueCents: 1_234_500,
      properties: {
        create: [
          {
            statePropertyId: `E2E-AGR-${tag}`,
            ownerNameRaw: `ESTATE OF ${ownerName.toUpperCase()}`,
            ownerId: owner.id,
            category: "LIFE_INSURANCE",
            holderName: "GREAT BASIN NATIONAL LIFE ASSURANCE",
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
  const heirName = `Jamie Agree${tag}`;
  const email = `jamie.${tag.toLowerCase()}@example.com`;
  const heir = await prisma.person.create({
    data: {
      caseId: c.id,
      fullName: heirName,
      normalizedName: heirName.toUpperCase(),
      relationship: "CHILD",
      relationshipConfidence: 0.93,
      status: "CONFIRMED",
      sourceEvidenceIds: [ev.id],
      mailingAddressEnc: encryptPii(`${Math.floor(Math.random() * 9000) + 100} Sage Ct, Reno, NV 89509`),
      emailEnc: encryptPii(email),
      emailHash: blindIndex(email),
    },
  });
  await prisma.communication.create({ data: { caseId: c.id, personId: heir.id, channel: "INBOUND_PHONE_NOTE", direction: "INBOUND", status: "RECEIVED", textContent: "Called; wants help (E2E fixture)." } });
  const access = await ensurePortalAccess(prisma, { caseId: c.id, personId: heir.id });
  writeFileSync(outFile, JSON.stringify({ caseId: c.id, heirName, portalPath: `/p/${access.token}` }));
  console.log(`e2e: created agreement case for ${ownerName}`);
}

main().finally(() => prisma.$disconnect());
