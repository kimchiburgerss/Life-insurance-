import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

export type Db = InstanceType<typeof PrismaClient>;

function createClient(): Db {
  // No throw here: `next build` imports this module without a database.
  // A missing DATABASE_URL surfaces on the first query instead.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
}

// One client (and connection pool) per process; survives Next.js dev HMR.
const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const prisma: Db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Either the root client or an interactive-transaction client. */
export type DbClient = Db | Parameters<Parameters<Db["$transaction"]>[0]>[0];
