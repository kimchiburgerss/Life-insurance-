import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./tests/e2e/db";

// Its own port, so a dev server you have running (on your dev database) is never reused.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

// Every process in the run (the app, global setup's fixtures, the tests) uses
// the dedicated E2E database, rebuilt from scratch each run by prepare-db.ts.
process.env.DATABASE_URL = e2eDatabaseUrl();

/**
 * End-to-end tests run on a fresh "<name>_e2e" database seeded with FAKE demo
 * data (tests/e2e/prepare-db.ts runs before the app starts). In CI the app is
 * built first and served with `next start`; locally `next dev` is used.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx tsx tests/e2e/prepare-db.ts && ${process.env.CI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    // Several sign-ins per minute from one IP; production keeps the default of 5.
    env: { MOCK_MODE: "true", AUTH_ATTEMPTS_PER_MINUTE: "60", BETTER_AUTH_URL: baseURL, PUBLIC_APP_URL: baseURL, DATABASE_URL: process.env.DATABASE_URL, LOB_WEBHOOK_SECRET: "e2e-lob-webhook-secret" },
  },
});
