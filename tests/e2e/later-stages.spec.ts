import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { LATER_STAGES_FILE } from "./global-setup";
import { E2E_LOB_WEBHOOK_SECRET, nevadaToday, OWNER, RESEARCHER, setRulesVerified, signIn } from "./helpers";
import { expect, expectAccessible, test, watchSecurityConsole } from "./fixtures";

type Fx = {
  letter: { caseId: string; heirName: string; letterId: string; optOutPath: string };
  filed: { caseId: string; heirName: string; packetId: string };
  approved: { caseId: string; heirName: string };
  paper: { caseId: string; heirName: string };
};
const fx = () => JSON.parse(readFileSync(LATER_STAGES_FILE, "utf8")) as Fx;
const AGREEMENT_RULES = ["NV · waiting period · v1", "NV · fee cap · v1", "NV · disclosure text · v1", "NV · agreement requirements · v1"];

test("a letter returned as undeliverable is recorded from Lob's signed webhook; unsigned calls are refused", async ({ page, request }) => {
  const { letter } = fx();
  const body = JSON.stringify({ id: `evt_${randomUUID()}`, event_type: { id: "letter.returned_to_sender" }, body: { id: letter.letterId }, date_created: new Date().toISOString() });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", E2E_LOB_WEBHOOK_SECRET).update(`${ts}.${body}`).digest("hex");
  expect((await request.post("/api/webhooks/lob", { data: body, headers: { "content-type": "application/json", "lob-signature-timestamp": ts, "lob-signature": "0".repeat(64) } })).status()).toBe(401);
  const ok = await request.post("/api/webhooks/lob", { data: body, headers: { "content-type": "application/json", "lob-signature-timestamp": ts, "lob-signature": sig } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ handled: true });

  await signIn(page, OWNER);
  await page.goto("/notifications");
  await expect(page.getByText("A letter was returned as undeliverable").first()).toBeVisible();
});

// Runs before the tests below change these cases: an owner would see these controls here.
test("a researcher can read a claim but can't record the State's decision or open the audit log", async ({ page }) => {
  const { filed, approved } = fx();
  await signIn(page, RESEARCHER);
  await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await page.goto(`/cases/${approved.caseId}`);
  await expect(page.getByRole("button", { name: "Record payment and prepare invoice" })).toHaveCount(0);
  await page.goto(`/claims/${filed.packetId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record decision" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve packet" })).toHaveCount(0);
});

test("the heir stops all letters from the link in the letter; the owner sees the opt-out", async ({ page, browser }) => {
  const { letter } = fx();
  const context = await browser.newContext();
  const problems: string[] = [];
  watchSecurityConsole(context, problems);
  const heir = await context.newPage();
  await heir.goto(letter.optOutPath);
  await expect(heir.getByRole("heading", { name: /^Stop letters and emails from/ })).toBeVisible();
  await expectAccessible(heir, "opt-out page");
  await heir.getByRole("button", { name: "Stop all letters and emails" }).click();
  await expect(heir.getByRole("status")).toContainText("You will not hear from");
  expect(problems).toEqual([]);
  await context.close();

  await signIn(page, OWNER);
  await page.goto(`/cases/${letter.caseId}`);
  await expect(page.getByText(/opted out|asked us not to contact/i).first()).toBeVisible();
});

test("the State asks for more information: the owner records it, builds a new packet and re-files", async ({ page }) => {
  test.setTimeout(180_000);
  const { filed } = fx();
  await signIn(page, OWNER);
  await page.goto(`/claims/${filed.packetId}`);
  await expect(page.getByRole("heading", { name: "Record the State's decision" })).toBeVisible();
  await expectAccessible(page, "claim packet (filed)");
  await page.getByLabel("Decision").selectOption("MORE_INFO");
  await page.getByLabel("What the State said").fill("Needs a certified copy of the death certificate");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByRole("heading", { name: "Outcome" })).toBeVisible({ timeout: 30_000 });

  await page.goto(`/cases/${filed.caseId}`);
  await expect(page.getByText("More Info Requested", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Start claim packet" }).click();
  await expect(page.getByRole("heading", { name: `Claim packet — ${filed.heirName}` })).toBeVisible({ timeout: 30_000 });
  await page.locator('select[name="estatePath"]').selectOption("SMALL_ESTATE");
  await page.locator('select[name="hasWill"]').selectOption("no");
  await page.getByRole("button", { name: "Save facts" }).click();
  await expect(page.getByRole("button", { name: "Assemble packet PDF" })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "Assemble packet PDF" }).click();
  await expect(page.getByText(/Assembled: \d+ pages\./)).toBeVisible({ timeout: 30_000 });
  await expectAccessible(page, "claim packet (ready for review)");
  await page.getByLabel(/I checked every page of this packet/).check();
  await page.getByRole("button", { name: "Approve packet" }).click();
  await expect(page.getByRole("heading", { name: "Record the filing" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("State claim ID").fill("NV-E2E-REFILED");
  await page.getByRole("button", { name: "Record filing" }).click();
  await expect(page.getByRole("heading", { name: "Record the State's decision" })).toBeVisible({ timeout: 30_000 });
  await page.goto(`/cases/${filed.caseId}`);
  await expect(page.getByText("Claim Filed", { exact: true }).first()).toBeVisible();
});

test("a mistyped payment amount: void the invoice, record the right amount, bill on paper and mark it paid", async ({ page }) => {
  test.setTimeout(180_000);
  const { approved } = fx();
  await signIn(page, OWNER);
  await page.goto(`/cases/${approved.caseId}`);
  await page.getByLabel("Amount the State paid the heir ($)").fill("1500.00");
  await page.getByLabel("How you know").fill("Heir read the amount over the phone");
  await page.getByRole("button", { name: "Record payment and prepare invoice" }).click();
  await expect(page.getByRole("heading", { name: "Fee invoice — $150.00" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Reason").fill("Amount mistyped: the State's letter says $15,000.00");
  await page.getByRole("button", { name: "Void invoice" }).click();
  await expect(page.getByText(/void/i).first()).toBeVisible({ timeout: 30_000 });

  await page.goto(`/cases/${approved.caseId}`);
  await page.getByLabel("Amount the State paid the heir ($)").fill("15000.00");
  await page.getByLabel("How you know").fill("Copy of the State's payment letter");
  await page.getByRole("button", { name: "Record payment and prepare invoice" }).click();
  await expect(page.getByRole("heading", { name: "Fee invoice — $1,500.00" })).toBeVisible({ timeout: 30_000 });
  await expectAccessible(page, "invoice (draft)");
  await page.getByLabel("Paper invoice you send yourself").check();
  await page.getByLabel(/The amount, the recipient and the reminders/).check();
  await page.getByRole("button", { name: "Approve and send invoice" }).click();
  await expect(page.getByText(/^Sent \d{4}-\d{2}-\d{2} \(manual\)/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("How (e.g. check number)").fill("Check #1042");
  await page.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.getByText(/^Paid \d{4}-\d{2}-\d{2}\. Thank you!$/)).toBeVisible({ timeout: 30_000 });
  await page.goto(`/cases/${approved.caseId}`);
  await expect(page.getByText("Fee Collected", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
});

test("a paper agreement: approve for paper, then record the signed copy the heir mailed back", async ({ page }) => {
  test.setTimeout(180_000);
  const { paper } = fx();
  await signIn(page, OWNER);
  let verifiedHere: string[] = [];
  try {
    verifiedHere = await setRulesVerified(page, AGREEMENT_RULES, true);
    await page.goto(`/cases/${paper.caseId}`);
    await page.getByRole("button", { name: "Prepare agreement" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`^Agreement .* with ${paper.heirName}$`) })).toBeVisible({ timeout: 30_000 });
    await expectAccessible(page, "agreement (waiting for approval)");
    await page.getByLabel("On paper (you print and mail it)").check();
    await page.getByLabel(/I have read this whole agreement/).check();
    await page.getByRole("button", { name: "Approve and send agreement" }).click();
    await expect(page.getByRole("heading", { name: "Record the paper signature" })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Signed copy (PDF or photo)").setInputFiles({ name: "signed-agreement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% fictional signed scan (E2E)\n%%EOF\n") });
    await page.getByLabel("Date the heir signed").fill(nevadaToday());
    await page.getByRole("button", { name: "Record paper signature" }).click();
    // The form goes away once signed; the page says so.
    await expect(page.getByText(`Signed ${nevadaToday()}.`)).toBeVisible({ timeout: 30_000 });
    await page.goto(`/cases/${paper.caseId}`);
    await expect(page.getByText("Agreement Signed", { exact: true }).first()).toBeVisible();
  } finally {
    if (verifiedHere.length) await setRulesVerified(page, verifiedHere, false);
  }
});
