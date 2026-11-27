/**
 * Remove an operator's access (e.g. someone leaves):
 *
 *   npm run user:remove -- --email them@yourfirm.com
 *
 * Signs them out everywhere and deletes their password and two-factor
 * credentials, so they can't sign in again. The user record stays (as a
 * VIEWER) because approvals and audit entries refer to it. To give access back
 * later, run `npm run user:create` with a new email address.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

const { values } = parseArgs({ options: { email: { type: "string" } } });

async function main() {
  const email = values.email?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run user:remove -- --email them@yourfirm.com");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No operator with email ${email}.`);
    process.exit(1);
  }
  const owners = await prisma.user.count({ where: { role: "OWNER", accounts: { some: {} } } });
  if (user.role === "OWNER" && owners <= 1) {
    console.error("This is the only OWNER who can sign in. Create another OWNER first.");
    process.exit(1);
  }
  await prisma.$transaction(async (tx) => {
    const sessions = await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.account.deleteMany({ where: { userId: user.id } });
    await tx.twoFactor.deleteMany({ where: { userId: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { role: "VIEWER", twoFactorEnabled: false } });
    await writeAudit(tx, {
      actor: { type: "SYSTEM", id: "script:user-remove" },
      action: "user.access_removed",
      entityType: "User",
      entityId: user.id,
      before: { role: user.role },
      after: { role: "VIEWER", sessionsEnded: sessions.count },
    });
  });
  console.log(`Access removed for ${email}: signed out everywhere; password and 2FA deleted.`);
}

main().finally(() => prisma.$disconnect());
