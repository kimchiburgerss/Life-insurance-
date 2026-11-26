import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { OUTREACH_CASE_FILE } from "./global-setup";
import { OWNER, signIn } from "./helpers";

const RULES = ["NV · waiting period · v1", "NV · fee cap · v1", "NV · disclosure text · v1"];

async function setRulesVerified(page: Page, rules: string[], verified: boolean): Promise<string[]> {
  const changed: string[] = [];
  await page.goto("/rules");
  for (const name of rules) {
    const card = page.locator("section", { hasText: name });
    const button = card.getByRole("button", { name: verified ? "Mark as verified" : "Mark as not verified" });
    if ((await button.count()) === 0) continue;
    if (verified) await card.getByLabel(/Note for the audit log/).fill("E2E: checked for the outreach test");
    await button.click();
    await expect(card.getByRole("button", { name: verified ? "Mark as not verified" : "Mark as verified" })).toBeVisible();
    changed.push(name);
  }
  return changed;
}

test("owner drafts, reviews and approves a letter; it is sent and the case becomes Contacted", async ({ page }) => {
  test.setTimeout(150_000);
  const fixture = JSON.parse(readFileSync(OUTREACH_CASE_FILE, "utf8")) as { caseId: string; ownerName: string; heirName: string };
  await signIn(page, OWNER);
  let verifiedHere: string[] = [];
  try {
    // Draft from the case page.
    await page.goto(`/cases/${fixture.caseId}`);
    const heirRow = page.locator("li", { hasText: fixture.heirName }).filter({ has: page.getByRole("button", { name: "Draft letter" }) });
    await heirRow.getByRole("button", { name: "Draft letter" }).click();
    await expect(page.getByRole("heading", { name: `Letter to ${fixture.heirName} (first contact)` })).toBeVisible({ timeout: 30_000 });
    const messageUrl = page.url();

    // Side-by-side: the rendered letter and the compliance checklist.
    await expect(page.getByTitle("Letter preview")).toBeVisible();
    const checklist = page.getByRole("list", { name: "Compliance checklist" });
    await expect(checklist.getByText("Free-claim disclosure with the State's program name and website (verbatim)")).toBeVisible();
    await expect(page.getByText("Plain-text version")).toBeVisible();

    // The demo ships with unverified rules → the checklist is red and approval is blocked.
    const approve = page.getByRole("button", { name: "Approve and send letter" });
    if (await page.getByText(/Not yet verified:/).isVisible()) {
      await expect(approve).toBeDisabled();
      verifiedHere = await setRulesVerified(page, RULES, true);
      await page.goto(messageUrl);
    }

    // The draft is in the approval queue.
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Approvals/ }).click();
    await page.getByRole("row", { name: new RegExp(fixture.heirName) }).getByRole("link", { name: "Review" }).click();
    await expect(page).toHaveURL(messageUrl);

    // Edit the AI-written personal note: the checks run again on the new text.
    await page.getByLabel(/Personal note/).fill(`We were sorry to learn of the passing of ${fixture.ownerName}.`);
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText(/Saved\. The tone check and checklist were run again/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Every checklist item must be green")).toHaveCount(0);

    // Approve this exact letter.
    await page.getByLabel(/I have read this whole letter/).check();
    await approve.click();
    // The decision panel closes once the message is no longer pending; the page shows the outcome.
    await expect(page.getByText(/^Approved by Demo Owner and sent \d{4}-\d{2}-\d{2} \(mock-mail\)\./)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Approval record" })).toBeVisible();
    await expect(page.getByText("Demo Owner", { exact: true })).toBeVisible();

    // The first approved send moved the case to Contacted.
    await page.goto(`/cases/${fixture.caseId}`);
    await expect(page.getByText("Contacted", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Letter · first contact" })).toBeVisible();
  } finally {
    if (verifiedHere.length) await setRulesVerified(page, verifiedHere, false);
  }
});
