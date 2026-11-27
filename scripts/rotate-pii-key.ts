/**
 * `npm run keys:rotate [-- --dry-run]` — re-encrypt stored contact details and
 * documents with the current PII_ENCRYPTION_KEY / PII_KEY_VERSION. Steps in
 * OPERATIONS.md → "Rotating the encryption key".
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { rotateEncryption } from "@/lib/crypto/rotate";

const dryRun = process.argv.includes("--dry-run");
rotateEncryption({ dryRun })
  .then((r) => {
    console.log(`${dryRun ? "Still to re-encrypt" : "Re-encrypted"} to key version ${r.version}:`);
    for (const [field, n] of Object.entries(r.fields)) console.log(`  ${field}: ${n}`);
    console.log(`  stored files: ${r.files}`);
    if (!dryRun) console.log("Done. Check `npm run keys:rotate -- --dry-run` shows 0 everywhere, then remove the old key from PII_PREVIOUS_KEYS.");
  })
  .finally(() => prisma.$disconnect());
