/**
 * Create a real operator account (public sign-up is disabled).
 *
 *   npm run user:create -- --email you@yourfirm.com --name "Your Name" --role OWNER
 *
 * You will be prompted for a password. The new operator enrolls TOTP on first
 * sign-in at /setup-2fa (the secret is never printed here).
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { provisionOperator } from "@/lib/auth/provision";
import { prisma } from "@/lib/db";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "VIEWER" },
  },
});

async function main() {
  const role = values.role?.toUpperCase();
  if (!values.email || !values.name || !role || !["OWNER", "RESEARCHER", "VIEWER"].includes(role)) {
    console.error('Usage: npm run user:create -- --email a@b.com --name "Name" --role OWNER|RESEARCHER|VIEWER');
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question("Password (min 12 characters): ");
  rl.close();
  const user = await provisionOperator(prisma, {
    email: values.email,
    name: values.name,
    role: role as "OWNER" | "RESEARCHER" | "VIEWER",
    password,
    createdBy: "cli:user:create",
  });
  console.log(`Created ${user.email} (${role}). Sign in and enroll 2FA at /setup-2fa.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
