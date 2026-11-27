/** E2E fixture: a signed case with the heir's documents accepted (all but the claim form), plus the heir's portal link. */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { createSignedClaimCase } from "./fixture-lib";

const [outFile] = process.argv.slice(2);
if (!outFile) throw new Error("usage: provision-claim-case.ts <out.json>");

createSignedClaimCase("Claim")
  .then((s) => {
    writeFileSync(outFile, JSON.stringify({ caseId: s.caseId, heirName: s.heirName, portalPath: s.portalPath }));
    console.log(`e2e: created claim case for ${s.ownerName}`);
  })
  .finally(() => prisma.$disconnect());
