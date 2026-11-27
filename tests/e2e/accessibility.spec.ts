import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { AGREEMENT_CASE_FILE, CLAIM_CASE_FILE } from "./global-setup";
import { OWNER, signIn } from "./helpers";
import { expect, expectAccessible, test, watchSecurityConsole } from "./fixtures";

// WCAG 2.2 AA automated checks (axe-core) on every main screen. Flow-specific
// screens (letter review, agreement, claim packet, invoice) are checked inside
// their own specs, where the data exists.

test("signed-out pages are accessible", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Heir Finder" })).toBeVisible();
  await expectAccessible(page, "/login");
  await page.goto("/portal");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectAccessible(page, "/portal (no session)");
});

test("every console screen is accessible", async ({ page }) => {
  test.setTimeout(240_000);
  const fx = JSON.parse(readFileSync(CLAIM_CASE_FILE, "utf8")) as { caseId: string };
  await signIn(page, OWNER);
  for (const path of ["/", "/pipeline", "/screening", "/review", "/approvals", "/calendar", "/metrics", "/imports", "/rules", "/do-not-contact", "/settings", "/audit", "/notifications", `/cases/${fx.caseId}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectAccessible(page, path, { soft: true });
  }
});

test("keyboard: skip link goes to the content, focus is visible", async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto("/pipeline"); // a full page load, as when arriving from a bookmark or link
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("the heir portal works on a phone, with larger text, and is accessible", async ({ browser }) => {
  const fx = JSON.parse(readFileSync(AGREEMENT_CASE_FILE, "utf8")) as { portalPath: string; heirName: string };
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const problems: string[] = [];
  watchSecurityConsole(context, problems);
  const heir = await context.newPage();
  await heir.goto(fx.portalPath);
  await expect(heir.getByRole("heading", { name: `Hello ${fx.heirName.split(" ")[0]}` })).toBeVisible();
  // Nothing wider than the screen.
  const overflow = await heir.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expectAccessible(heir, "heir portal (phone)");
  const toggle = heir.getByRole("button", { name: "Larger text" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await heir.evaluate(() => document.documentElement.style.fontSize)).toBe("125%");
  await expectAccessible(heir, "heir portal (phone, larger text)");
  expect(problems).toEqual([]);
  await context.close();
});
