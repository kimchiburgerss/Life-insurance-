/**
 * Fresh database for every end-to-end run (run by the Playwright webServer
 * command, before the app starts): create "<name>_e2e" if needed, apply
 * migrations, empty every table except the append-only audit log, and seed
 * the FAKE demo data. Refuses any database whose name doesn't end in "_e2e".
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { Client } from "pg";
import { e2eDatabaseUrl } from "./db";

async function main() {
  const url = e2eDatabaseUrl();
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/^[a-z0-9_]+_e2e$/.test(name)) throw new Error(`Refusing to reset database "${name}": end-to-end tests need a database named *_e2e.`);

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const env = { ...process.env, DATABASE_URL: url, SEED_DEMO: "true" };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT IN ('audit_logs', '_prisma_migrations')`,
    );
    if (rows.length) await client.query(`TRUNCATE ${rows.map((r) => `"${r.table_name}"`).join(", ")} CASCADE`);
    await client.query("DROP SCHEMA IF EXISTS pgboss CASCADE"); // no jobs left over from the last run
  } finally {
    await client.end();
  }
  execSync("npx prisma db seed", { stdio: "inherit", env });
  console.log(`e2e: database ${name} is fresh`);
  // Locally the app runs on `next dev`: start from a clean compile cache, since a
  // stale one can make pages reload in a loop after source changes.
  if (!process.env.CI) rmSync(".next/dev", { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
