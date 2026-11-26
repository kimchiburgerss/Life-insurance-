import { expect, test } from "@playwright/test";
import { OWNER, signIn } from "./helpers";

test("owner verifies a jurisdiction rule; the change is in the audit log", async ({ page }) => {
  await signIn(page, OWNER);
  await page.getByRole("link", { name: "Jurisdiction rules" }).click();

  const card = page.locator("section", { hasText: "NV · fee cap · v1" });
  const note = `E2E check ${Date.now()}`;
  await card.getByLabel(/Note for the audit log/).fill(note);
  await card.getByRole("button", { name: "Mark as verified" }).click();
  await expect(card.getByText(/^verified .* by Demo Owner$/)).toBeVisible();

  await page.getByRole("link", { name: "Audit log" }).click();
  const row = page.getByRole("row", { name: new RegExp(note) });
  await expect(row).toContainText("rule.verified");

  // Restore the unverified state so the demo keeps showing the warning.
  await page.getByRole("link", { name: "Jurisdiction rules" }).click();
  await card.getByRole("button", { name: "Mark as not verified" }).click();
  await expect(card.getByText("not verified")).toBeVisible();
});
