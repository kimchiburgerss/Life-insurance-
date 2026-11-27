/**
 * The proxy doesn't run on /api/* (so uploads aren't cut off at its 10 MB
 * body buffer), which makes every route handler responsible for its own
 * access check. This test fails if a route under app/api has none, or if the
 * proxy matcher stops excluding /api.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicPage } from "@/lib/security/csp";
import { config } from "@/proxy";

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? routes(p) : f === "route.ts" ? [p.split(path.sep).join("/")] : [];
  });
}

/** Each route must show one of these checks. */
const CHECKS: { name: string; pattern: RegExp }[] = [
  { name: "operator session (2FA)", pattern: /requireOperator\(|session\.user\.twoFactorEnabled/ },
  { name: "heir portal session", pattern: /currentPortal\(\)/ },
  { name: "webhook signature", pattern: /verify\w*(Signature|Event)\(/ },
  { name: "opt-out token", pattern: /isOptOutToken\(/ },
];
/** Public by design, with the reason. */
const PUBLIC: Record<string, string> = {
  "app/api/auth/[...all]/route.ts": "Better Auth's own endpoints (rate-limited, origin-checked)",
  "app/api/health/route.ts": "health check; returns no data",
};

describe("API routes authenticate themselves", () => {
  const all = routes("app/api");

  it("finds the routes", () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it.each(all)("%s has an access check", (file) => {
    if (PUBLIC[file]) return;
    const text = readFileSync(file, "utf8");
    const matched = CHECKS.filter((c) => c.pattern.test(text)).map((c) => c.name);
    expect(matched, `${file} has no access check`).not.toEqual([]);
  });

  it("the proxy skips /api but covers every page, and only exempts the public pages from the login redirect", () => {
    const matcher = new RegExp(`^${config.matcher[0]!}$`);
    for (const p of ["/api/claims/x/documents", "/api/files/x", "/api/portal/documents"]) expect(matcher.test(p)).toBe(false);
    for (const p of ["/", "/login", "/portal", "/p/abc", "/cases/x", "/settings"]) expect(matcher.test(p)).toBe(true);
    expect(["/login", "/portal", "/p/abcdefghij", "/u/abcdefghij"].every(isPublicPage)).toBe(true);
    expect(["/", "/cases/x", "/portals", "/p/a/b", "/settings", "/loginx"].some(isPublicPage)).toBe(false);
  });
});

describe("Content-Security-Policy", () => {
  it("allows only nonced scripts, nothing from other origins, no framing by other sites", async () => {
    const { buildCsp, newNonce } = await import("@/lib/security/csp");
    const n = newNonce();
    expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(n);
    const prod = buildCsp(n, { dev: false, https: true });
    expect(prod).toContain(`script-src 'self' 'nonce-${n}' 'strict-dynamic'`);
    expect(prod).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|\*/);
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "upgrade-insecure-requests"]) expect(prod).toContain(d);
    expect(buildCsp(n, { dev: true, https: false })).toContain("'unsafe-eval'");
    expect(buildCsp(n, { dev: false, https: false })).not.toContain("upgrade-insecure-requests");
  });
});
