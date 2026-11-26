import "dotenv/config";
import { provisionOperator } from "@/lib/auth/provision";
import { prisma } from "@/lib/db";

const [email, password] = process.argv.slice(2);
if (!email || !password) throw new Error("usage: provision-unenrolled.ts <email> <password>");

provisionOperator(prisma, { email, password, name: "New Operator", role: "RESEARCHER", createdBy: "e2e" })
  .then(() => console.log(`e2e: created un-enrolled operator ${email}`))
  .finally(() => prisma.$disconnect());
