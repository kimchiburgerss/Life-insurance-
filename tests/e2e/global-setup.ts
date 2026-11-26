/**
 * Creates a fresh operator WITHOUT 2FA for the enrollment test. Runs the
 * provisioning code through tsx (the app code is ESM).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const UNENROLLED_FILE = "test-results/.unenrolled-user.json";

export default function globalSetup() {
  const creds = {
    email: `new-operator-${randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-${randomUUID()}`,
  };
  execFileSync(
    "npx",
    ["tsx", "--conditions=react-server", "tests/e2e/provision-unenrolled.ts", creds.email, creds.password],
    { stdio: "inherit" },
  );
  mkdirSync("test-results", { recursive: true });
  writeFileSync(UNENROLLED_FILE, JSON.stringify(creds));
}
