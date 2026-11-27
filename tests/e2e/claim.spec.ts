import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { expect, expectAccessible, test } from "./fixtures";
import { CLAIM_CASE_FILE } from "./global-setup";
import { OWNER, signIn } from "./helpers";

async function pdf(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([612, 792]).drawText("Claim form, notarized (fictional, E2E)", { x: 72, y: 700, size: 14, font: f });
  return Buffer.from(await d.save());
}

test("owner builds and files the claim, bills the fee after the State pays, the heir pays, and the case closes as won", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const fx = JSON.parse(readFileSync(CLAIM_CASE_FILE, "utf8")) as { caseId: string; heirName: string; portalPath: string };
  await signIn(page, OWNER);

  // Start the claim packet from the case page.
  await page.goto(`/cases/${fx.caseId}`);
  await page.getByRole("button", { name: "Start claim packet" }).click();
  await expect(page.getByRole("heading", { name: `Claim packet — ${fx.heirName}` })).toBeVisible({ timeout: 30_000 });

  // Confirm the estate facts: the Treasurer's small-estate forms appear.
  await page.locator('select[name="estatePath"]').selectOption("SMALL_ESTATE");
  await page.locator('select[name="hasWill"]').selectOption("no");
  await page.getByRole("button", { name: "Save facts" }).click();
  await expect(page.getByText("Saved. The document list was updated.")).toBeVisible();
  await expect(page.getByText("form UP-45")).toBeVisible();
  await expect(page.getByText("form UP-40")).toBeVisible();

  // The signed claim form arrived by mail: upload it and accept it.
  await page.locator('select[name="checklistKey"]').selectOption({ index: 0 });
  await page.getByLabel("File (PDF or photo)").setInputFiles({ name: "claim-form-notarized.pdf", mimeType: "application/pdf", buffer: await pdf() });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("claim-form-notarized.pdf")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Accept" }).first().click();
  await expect(page.getByRole("button", { name: "Assemble packet PDF" })).toBeEnabled({ timeout: 30_000 });

  // One PDF: cover letter + documents. Approve it, then record the filing and the decision.
  await page.getByRole("button", { name: "Assemble packet PDF" }).click();
  await expect(page.getByText(/Assembled: \d+ pages\./)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle("Claim packet PDF")).toBeVisible();
  await expectAccessible(page, "claim packet (assembled)");
  await page.getByLabel(/I checked every page of this packet/).check();
  await page.getByRole("button", { name: "Approve packet" }).click();
  await expect(page.getByRole("heading", { name: "Record the filing" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("State claim ID").fill("NV-E2E-4471");
  await page.getByRole("button", { name: "Record filing" }).click();
  await expect(page.getByRole("heading", { name: "Record the State's decision" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByRole("heading", { name: "Outcome" })).toBeVisible({ timeout: 30_000 });

  // The State paid the heir: record it; the invoice is prepared from the agreement's percentage.
  await page.goto(`/cases/${fx.caseId}`);
  await page.getByLabel("Amount the State paid the heir ($)").fill("12345.00");
  await page.getByLabel("How you know").fill("Heir emailed the State's payment letter");
  await page.getByRole("button", { name: "Record payment and prepare invoice" }).click();
  await expect(page.getByRole("heading", { name: "Fee invoice — $1,234.50" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(/The amount, the recipient and the reminders/).check();
  await page.getByRole("button", { name: "Approve and send invoice" }).click();
  await expect(page.getByText(/^Sent \d{4}-\d{2}-\d{2} \(mock-payments\)/)).toBeVisible({ timeout: 30_000 });
  await expectAccessible(page, "invoice (sent)");

  // The heir pays in the portal (demo stand-in for the online payment page).
  const heirContext = await browser.newContext();
  const heir = await heirContext.newPage();
  await heir.goto(fx.portalPath);
  await expect(heir.getByRole("heading", { name: "Your claim" })).toBeVisible();
  await expect(heir.getByText(/the State approved your claim/)).toBeVisible();
  await expect(heir.getByText("$1,234.50")).toBeVisible();
  await heir.getByRole("button", { name: "Pay invoice (demo)" }).click();
  await expect(heir.getByText(/^Paid on \d{4}-\d{2}-\d{2}\. Thank you\.$/)).toBeVisible({ timeout: 30_000 });
  await heirContext.close();

  // Fee collected → close the case as won.
  await page.goto(`/cases/${fx.caseId}`);
  await expect(page.getByText("Fee Collected", { exact: true }).first()).toBeVisible();
  await page.locator("li", { hasText: /Move to Closed won/i }).getByRole("button").click();
  await expect(page.getByText(/Moved to closed won/i)).toBeVisible({ timeout: 30_000 });

  // Metrics show the revenue.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Metrics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Revenue" })).toBeVisible();
});
