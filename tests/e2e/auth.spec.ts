import { readFileSync } from "node:fs";
import { expect, expectAccessible, test } from "./fixtures";
import { totp } from "../../lib/auth/totp";
import { UNENROLLED_FILE } from "./global-setup";
import { DEMO_TOTP_SECRET, OWNER, signIn, signInWithPassword, VIEWER } from "./helpers";

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/rules");
  await expect(page).toHaveURL(/\/login$/);
});

test("owner signs in with password + TOTP and sees the Today view", async ({ page }) => {
  await signIn(page, OWNER);
  await expect(page.getByText(/\d+ cases · \d+ properties/)).toBeVisible();
  await expect(page.getByRole("table", { name: /cases in each pipeline stage/i })).toBeVisible();
  await expect(page.getByText(/not been verified/)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("a wrong TOTP code is rejected", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  const wrong = totp(DEMO_TOTP_SECRET) === "123456" ? "654321" : "123456";
  await page.getByLabel(/6-digit code/).fill(wrong);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("a new operator must enroll TOTP before reaching any page", async ({ page }) => {
  const creds = JSON.parse(readFileSync(UNENROLLED_FILE, "utf8")) as { email: string; password: string };
  await signInWithPassword(page, creds);
  await expect(page).toHaveURL(/\/setup-2fa$/);

  // Every app page bounces back to enrollment until 2FA is on.
  await page.goto("/rules");
  await expect(page).toHaveURL(/\/setup-2fa$/);

  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Start setup" }).click();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expectAccessible(page, "/setup-2fa");
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});

test("viewer has read-only access: no audit log and no rule controls", async ({ page }) => {
  await signIn(page, VIEWER);
  await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Jurisdiction rules" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mark as/ })).toHaveCount(0);
});
