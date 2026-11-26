import { expect, type Page } from "@playwright/test";
import { totp } from "../../lib/auth/totp";

export const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
export const OWNER = { email: "owner@example.com", password: "demo-owner-password" };
export const VIEWER = { email: "viewer@example.com", password: "demo-viewer-password" };

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

/** Full sign-in for a demo account: password, then the current TOTP code. */
export async function signIn(page: Page, creds: { email: string; password: string }) {
  await signInWithPassword(page, creds);
  await page.getByLabel(/6-digit code/).fill(totp(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}
