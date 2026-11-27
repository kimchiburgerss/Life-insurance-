import { readFileSync } from "node:fs";
import { expect, expectAccessible, test, type Page } from "./fixtures";
import { AGREEMENT_CASE_FILE } from "./global-setup";
import { OWNER, signIn } from "./helpers";

const RULES = ["NV · waiting period · v1", "NV · fee cap · v1", "NV · disclosure text · v1", "NV · agreement requirements · v1"];
const PDF = Buffer.from("%PDF-1.4\n% fictional death certificate scan (E2E)\n%%EOF\n");

async function setRulesVerified(page: Page, rules: string[], verified: boolean): Promise<string[]> {
  const changed: string[] = [];
  await page.goto("/rules");
  for (const name of rules) {
    const card = page.locator("section", { hasText: name });
    const button = card.getByRole("button", { name: verified ? "Mark as verified" : "Mark as not verified" });
    if ((await button.count()) === 0) continue;
    if (verified) await card.getByLabel(/Note for the audit log/).fill("E2E: checked for the agreement test");
    await button.click();
    await expect(card.getByRole("button", { name: verified ? "Mark as not verified" : "Mark as verified" })).toBeVisible();
    changed.push(name);
  }
  return changed;
}

test("owner prepares and approves an agreement; the heir signs it and uploads a document in the portal", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const fx = JSON.parse(readFileSync(AGREEMENT_CASE_FILE, "utf8")) as { caseId: string; heirName: string; portalPath: string };
  await signIn(page, OWNER);
  let verifiedHere: string[] = [];
  try {
    verifiedHere = await setRulesVerified(page, RULES, true);

    // Prepare the agreement from the case page (fee defaults to the setting, capped by law).
    await page.goto(`/cases/${fx.caseId}`);
    await page.getByRole("button", { name: "Prepare agreement" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`^Agreement .* with ${fx.heirName}$`) })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("DRAFT text", { exact: true })).toBeVisible();
    await expect(page.getByTitle("Agreement PDF")).toBeVisible();
    const checks = page.getByRole("list", { name: "Agreement checks" });
    await expect(checks.getByText("Fee within the legal cap")).toBeVisible();
    await expect(checks.getByText("Signed after the 24-month void period (NRS 120A.740)")).toBeVisible();
    await expectAccessible(page, "agreement review");

    // Approve this exact PDF for electronic signature.
    await page.getByLabel(/I have read this whole agreement/).check();
    await page.getByRole("button", { name: "Approve and send agreement" }).click();
    await expect(page.getByText(/for electronic signature \(mock-esign\)/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Approval record" })).toBeVisible();

    // The heir opens the link from the letter (separate browser session, no operator login).
    const heirContext = await browser.newContext();
    const heir = await heirContext.newPage();
    await heir.goto(fx.portalPath);
    await expect(heir).toHaveURL(/\/portal$/);
    await expect(heir.getByRole("heading", { name: `Hello ${fx.heirName.split(" ")[0]}` })).toBeVisible();
    await expect(heir.getByRole("heading", { name: "You can claim this yourself, for free" })).toBeVisible();
    await expect(heir.getByRole("link", { name: "Read the agreement (PDF)" })).toBeVisible();
    await expectAccessible(heir, "heir portal with an agreement to sign");

    // Upload a document for the claim checklist.
    await heir.getByLabel("Which document is this?").selectOption("death_certificate");
    await heir.getByLabel(/File \(a PDF or a clear photo\)/).setInputFiles({ name: "death-certificate.pdf", mimeType: "application/pdf", buffer: PDF });
    await heir.getByRole("button", { name: "Upload document" }).click();
    await expect(heir.getByText("Thank you. We received your document.")).toBeVisible({ timeout: 30_000 });
    await expect(heir.getByText(/death-certificate\.pdf/)).toBeVisible();

    // Sign (demo stand-in for the e-signature vendor's page).
    await heir.getByLabel(/I have read the agreement and I want to sign it electronically/).check();
    await heir.getByLabel("Type your full name to sign").fill(fx.heirName);
    await heir.getByRole("button", { name: "Sign agreement" }).click();
    await expect(heir.getByText(/You signed the agreement on/)).toBeVisible({ timeout: 30_000 });
    await expect(heir.getByRole("link", { name: "Download your signed copy" })).toBeVisible();

    // Send a message.
    await heir.getByLabel("Your message").fill("Thank you. What happens next?");
    await heir.getByRole("button", { name: "Send message" }).click();
    await expect(heir.getByText(/Your message was sent/)).toBeVisible();
    await heirContext.close();

    // Back in the console: the case advanced and the document is waiting for review.
    await page.goto(`/cases/${fx.caseId}`);
    await expect(page.getByText("Agreement Signed", { exact: true }).first()).toBeVisible();
    const docs = page.locator("section", { has: page.getByRole("heading", { name: /^Documents from heirs/ }) });
    await expect(docs.getByText(/^Owner's death certificate/)).toBeVisible();
    await docs.getByRole("button", { name: "Looks good" }).click();
    await expect(docs.getByText("accepted", { exact: true })).toBeVisible();
  } finally {
    if (verifiedHere.length) await setRulesVerified(page, verifiedHere, false);
  }
});
