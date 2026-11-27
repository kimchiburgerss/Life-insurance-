/**
 * E2E fixture for the later-stage flows: a letter that was sent (returned mail,
 * opt-out link), a filed claim (State asks for more information), a claim
 * the State approved (billing corrections) and a case ready for a paper agreement.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { createFiledClaimCase, createRespondedCase, createSentLetterCase } from "./fixture-lib";

const [outFile] = process.argv.slice(2);
if (!outFile) throw new Error("usage: provision-later-stages.ts <out.json>");

async function main() {
  const letter = await createSentLetterCase();
  const filed = await createFiledClaimCase("Refile");
  const approved = await createFiledClaimCase("Billing", { stateApproved: true });
  const paper = await createRespondedCase("Paper");
  writeFileSync(outFile, JSON.stringify({ letter, filed, approved, paper }));
  console.log("e2e: created letter, filed-claim and approved-claim cases");
}

main().finally(() => prisma.$disconnect());
