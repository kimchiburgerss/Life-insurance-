// Prisma 7 CLI configuration (Prisma 7.10+ looks for `prisma7.config.ts` first).
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
