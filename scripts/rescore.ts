/** `npm run cases:rescore` — recompute priority, expected value and eligibility for all open cases. */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { rescoreOpenCases } from "@/lib/screening/maintenance";

rescoreOpenCases(prisma)
  .then((n) => console.log(`Rescored ${n} open cases.`))
  .finally(() => prisma.$disconnect());
