import { expect, test } from "@playwright/test";
import { OWNER, signIn } from "./helpers";

test("research: find an obituary, extract with AI, accept, build the family, auto-advance", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, OWNER);
  const nav = (name: string) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true });

  // Open a screened case from the pipeline board.
  await nav("Pipeline").click();
  const screened = page.locator("section", { has: page.getByRole("heading", { name: /^Screened/ }) });
  await screened.getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: /^Estate of / })).toBeVisible();
  // (The import spec checks that this move is blocked before a death source exists.)

  // Search the configured (demo) death-record source and add the result.
  await page.getByRole("button", { name: "Search configured death-record sources" }).click();
  await expect(page.getByText(/FICTIONAL DEMO OBITUARY/).first()).toBeVisible();
  await page.getByRole("button", { name: "Add as a source" }).first().click();
  await expect(page.getByText("Source added.")).toBeVisible();

  // AI extraction is a suggestion until accepted.
  await page.getByRole("button", { name: "Extract facts with AI" }).last().click();
  await expect(page.getByText(/AI suggestion from/)).toBeVisible();
  await expect(page.getByText("Is this our owner?")).toBeVisible();
  await expect(page.getByText(/name similarity 100%/)).toBeVisible();
  await page.getByLabel(/this obituary is about our owner/).check();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  // The review panel closes once accepted; the case now shows the confirmed death.
  await expect(page.getByText(/Death confirmed/)).toBeVisible();
  await expect(page.getByText("facts accepted").first()).toBeVisible();
  await expect(page.getByText(/AI suggestion from/)).toHaveCount(0);

  // Family tree + intestate aid.
  await expect(page.getByLabel("Family tree")).toBeVisible();
  await expect(page.getByText("research aid, not legal advice").first()).toBeVisible();

  // Death is now cited → the case can move on.
  await page.locator("li", { hasText: "Move to Owner verified deceased" }).getByRole("button").click();
  await expect(page.getByText("Moved to owner verified deceased.")).toBeVisible();
  await page.locator("li", { hasText: "Move to Heirs researching" }).getByRole("button").click();
  await expect(page.getByText("Moved to heirs researching.")).toBeVisible();
  await page.locator("li", { hasText: "Move to Heirs identified" }).getByRole("button").click();
  await expect(page.getByText(/Moved to heirs identified\.( It then moved to (waiting period|ready for outreach) automatically\.| It is past the waiting period but can't go to outreach yet)/)).toBeVisible();

  // AI research summary.
  await page.getByRole("button", { name: /Generate research summary|Regenerate summary/ }).click();
  await expect(page.getByRole("heading", { name: "Next best steps" })).toBeVisible();

  // Calendar renders.
  await nav("Calendar").click();
  await expect(page.getByRole("heading", { name: "Waiting-period calendar" })).toBeVisible();
});
