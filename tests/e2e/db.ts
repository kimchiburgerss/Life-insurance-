/** The E2E database: DATABASE_URL_E2E, or DATABASE_URL with "_e2e" added to its name. Never the dev database. */
export function e2eDatabaseUrl(): string {
  if (process.env.DATABASE_URL_E2E) return process.env.DATABASE_URL_E2E;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Set DATABASE_URL_E2E (or DATABASE_URL) for the end-to-end tests.");
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "").replace(/_e2e$/, "")}_e2e`;
  return url.toString();
}
