/**
 * Fixed-window rate limit for public endpoints (portal, uploads, opt-out),
 * stored in Postgres so it works across server instances. Atomic upsert.
 */
import "server-only";
import { prisma } from "@/lib/db";

export async function allowRequest(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "request_limits" ("key", "windowStart", "count")
    VALUES (${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "request_limits"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE "request_limits"."count" + 1 END,
      "windowStart" = CASE WHEN "request_limits"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE "request_limits"."windowStart" END
    RETURNING "count"`;
  return (rows[0]?.count ?? 0) <= limit;
}

export class RateLimitedError extends Error {
  constructor() {
    super("Too many requests. Please wait a few minutes and try again.");
    this.name = "RateLimitedError";
  }
}

export async function enforceLimit(key: string, limit: number, windowSeconds: number) {
  if (!(await allowRequest(key, limit, windowSeconds))) throw new RateLimitedError();
}
