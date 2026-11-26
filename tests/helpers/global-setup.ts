/**
 * Integration tests run against a dedicated database whose name must end in
 * "_test". Setup is non-destructive to the schema: apply pending migrations
 * (`migrate deploy`), empty every table EXCEPT the append-only audit log
 * (which the database itself protects), then seed the jurisdiction rules.
 * Tests use unique ids, so old audit rows never interfere.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { Client } from "pg";
import { testDatabaseUrl } from "./test-db";

export default async function setup() {
  const url = testDatabaseUrl();
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to clear database "${dbName}": integration tests need a database named *_test.`);
  }
  const env = { ...process.env, DATABASE_URL: url, SEED_DEMO: "false" };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name NOT IN ('audit_logs', '_prisma_migrations')`,
    );
    if (rows.length > 0) {
      await client.query(`TRUNCATE ${rows.map((r) => `"${r.table_name}"`).join(", ")} CASCADE`);
    }
  } finally {
    await client.end();
  }
  execSync("npx prisma db seed", { stdio: "inherit", env });
}
