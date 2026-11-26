/**
 * `npm run demo` — one command to click through the app in mock mode:
 *   1. checks Postgres is reachable (starts it with Docker Compose if possible)
 *   2. resets the database, applies migrations and seeds FAKE demo data
 *   3. starts the Next.js dev server with MOCK_MODE=true
 *
 * WARNING: this wipes the database in DATABASE_URL. It refuses to run when
 * NODE_ENV=production.
 */
import "dotenv/config";
import { execSync, spawn } from "node:child_process";
import { Client } from "pg";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run the demo against a production environment.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

async function dbReachable(): Promise<boolean> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await dbReachable())) {
    console.log("Postgres not reachable — trying `docker compose up -d db` …");
    try {
      execSync("docker compose up -d --wait db", { stdio: "inherit" });
    } catch {
      console.error("Could not start Postgres. Start it yourself (see README) and re-run `npm run demo`.");
      process.exit(1);
    }
  }
  const run = (cmd: string) => execSync(cmd, { stdio: "inherit", env: { ...process.env, MOCK_MODE: "true" } });
  run("npx prisma migrate reset --force");
  run("npx prisma db seed");
  console.log("\nStarting http://localhost:3000 in mock mode …\n");
  spawn("npx", ["next", "dev"], { stdio: "inherit", env: { ...process.env, MOCK_MODE: "true" } });
}

void main();
