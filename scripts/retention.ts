/**
 * `npm run retention` — apply the data-retention policy now (it also runs nightly).
 * `npm run retention -- --dry-run` — only report what would be removed.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { RETENTION, runRetention } from "@/lib/retention/purge";

const dryRun = process.argv.includes("--dry-run");
console.log(`Policy: lost cases ${RETENTION.lostContactDays} days, won-case documents ${RETENTION.wonDocumentDays} days, all records ${RETENTION.recordDays} days after closing.`);
runRetention(new Date(), { dryRun })
  .then((r) =>
    console.log(
      `${dryRun ? "Would purge" : "Purged"}: ${r.cases} cases · ${r.contactPurgedPeople} people's contact details · ${r.messagesCleared} heir messages · ${r.portalLinksRevoked} portal links · ${r.filesPurged} files.`,
    ),
  )
  .finally(() => prisma.$disconnect());
