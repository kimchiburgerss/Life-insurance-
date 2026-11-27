import { expect, type Page } from "@playwright/test";
import { totp } from "../../lib/auth/totp";

export const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
export const OWNER = { email: "owner@example.com", password: "demo-owner-password" };
export const VIEWER = { email: "viewer@example.com", password: "demo-viewer-password" };
export const RESEARCHER = { email: "researcher@example.com", password: "demo-researcher-password" };

/** Shared with playwright.config.ts (the app's LOB_WEBHOOK_SECRET in E2E runs). */
export const E2E_LOB_WEBHOOK_SECRET = "e2e-lob-webhook-secret";

/** Today's date in Nevada (YYYY-MM-DD), as the app counts days. */
export const nevadaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());

/** Verify (or un-verify) rules on the Jurisdiction rules page; returns the ones changed. */
export async function setRulesVerified(page: Page, rules: string[], verified: boolean): Promise<string[]> {
  const changed: string[] = [];
  await page.goto("/rules");
  for (const name of rules) {
    const card = page.locator("section", { hasText: name });
    const button = card.getByRole("button", { name: verified ? "Mark as verified" : "Mark as not verified" });
    if ((await button.count()) === 0) continue;
    if (verified) await card.getByLabel(/Note for the audit log/).fill("E2E: checked for this test");
    await button.click();
    await expect(card.getByRole("button", { name: verified ? "Mark as not verified" : "Mark as verified" })).toBeVisible();
    changed.push(name);
  }
  return changed;
}

export async function signInWithPassword(page: Page, creds: { email: string; password: string }) {
  await page.goto("/login");
  // On a cold dev server the first compile can reload the page and wipe what was
  // typed, so submit until the form reacts (TOTP step, 2FA setup, or an error).
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.getByLabel("Email").fill(creds.email);
    await page.getByLabel("Password").fill(creds.password);
    await page.getByRole("button", { name: "Continue" }).click();
    const reacted = page
      .getByLabel(/6-digit code/)
      .or(page.getByRole("heading", { name: /Set up two-factor/ }))
      .or(page.getByRole("alert"));
    try {
      await reacted.first().waitFor({ timeout: attempt === 3 ? 30_000 : 8_000 });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
}

// TOTP codes are single-use (lib/auth/totp-replay.ts) and the server accepts the
// previous, current and next 30-second code. Tests sign the same account in many
// times, so pick a code this run hasn't used, waiting for a new step if needed.
const usedCodes = new Map<string, Set<string>>();

async function freshCode(email: string): Promise<string> {
  const used = usedCodes.get(email) ?? new Set<string>();
  usedCodes.set(email, used);
  for (;;) {
    const now = Date.now();
    const code = [now, now - 30_000, now + 30_000].map((t) => totp(DEMO_TOTP_SECRET, t)).find((c) => !used.has(c));
    if (code) {
      used.add(code);
      return code;
    }
    await new Promise((r) => setTimeout(r, 30_000 - (now % 30_000) + 200));
  }
}

/** Full sign-in for a demo account: password, then an unused TOTP code. */
export async function signIn(page: Page, creds: { email: string; password: string }) {
  await signInWithPassword(page, creds);
  for (let attempt = 1; ; attempt++) {
    await page.getByLabel(/6-digit code/).fill(await freshCode(creds.email));
    await page.getByRole("button", { name: "Verify" }).click();
    const today = page.getByRole("heading", { name: "Today" });
    const reused = page.getByText(/already used/);
    await expect(today.or(reused)).toBeVisible();
    if (await today.isVisible()) return;
    if (attempt === 3) throw new Error("No unused TOTP code accepted");
  }
}

/** Next unused TOTP code for an account (for tests that type the code themselves). */
export const nextTotp = (email: string) => freshCode(email);
