import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { OWNER, signIn } from "./helpers";

// Each run gets its own property IDs and fully random surnames. (Appending a
// tag to real surnames isn't enough: the matcher rightly treats "BRANNIGANAB"
// and "BRANNIGANCD" at the same address as one person across runs.)
const letters = (n: number) => Array.from({ length: n }, () => "BCDFGHJKLMNPRSTVWZ"[randomInt(18)]! + "AEIOU"[randomInt(5)]!).join("");
const TAG = letters(3);
const SURNAMES = ["WINSLOW", "OKAFOR", "BRANNIGAN", "HALVORSEN", "VANTERPOOL", "ABERNATHY", "FAIRWEATHER", "OYELARAN", "MOONSAMY", "VELLACOTT", "ASHWORTH", "KRZYZANOWSKI", "TREMBATH", "PENHALIGON", "QUINTANILLA", "ACHTERBERG", "OKONKWO", "DELACROIX"];
const NAME = Object.fromEntries(SURNAMES.map((s) => [s, letters(4)]));
const csv = readFileSync("demo/sample-nevada-export.csv", "utf8")
  .replace(/NVX-/g, `NVX${TAG}-`)
  .replace(new RegExp(`\\b(${SURNAMES.join("|")})\\b`, "gi"), (m) => NAME[m.toUpperCase()]!);
const title = (s: string) => s[0] + s.slice(1).toLowerCase();

test("import → map → review → screen → case page", async ({ page }) => {
  test.setTimeout(120_000);
  const nav = (name: string) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true });
  await signIn(page, OWNER);

  // Upload
  await nav("Imports").click();
  await page.getByLabel(/File \(/).setInputFiles({ name: `demo-${TAG}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByLabel("Where did this file come from?").fill("E2E fictional demo file");
  await page.getByRole("button", { name: "Upload and map columns" }).click();

  // Mapping was suggested from the headers
  await expect(page.getByRole("heading", { name: `demo-${TAG}.csv` })).toBeVisible();
  await expect(page.getByLabel("State property ID *")).toHaveValue("Property ID");
  await expect(page.getByLabel("Amount")).toHaveValue("Cash Reported");
  await expect(page.getByLabel("Date delivered (remitted) to the state")).toHaveValue("Date Remitted");

  // Preview
  await page.getByRole("button", { name: "Preview how rows will be imported" }).click();
  await expect(page.getByText(/25 rows · 1 would be skipped/)).toBeVisible();
  await expect(page.getByText(/Skipped: Invalid calendar date/)).toBeVisible();

  // Import runs in the background job; the page refreshes itself.
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByRole("heading", { name: "Result" })).toBeVisible({ timeout: 60_000 });
  const stat = (label: string) => page.locator("dl > div", { hasText: label }).locator("dd");
  await expect(stat("New properties")).toHaveText("23");
  await expect(stat("Duplicates skipped")).toHaveText("1");
  await expect(stat("Rows with errors")).toHaveText("1");
  await expect(stat("Need review")).toHaveText("2");

  // Review queue: nickname → keep separate; missing address → merge
  await page.getByRole("link", { name: /Review 2 possible duplicate owners/ }).click();
  const okafor = page.locator("section", { hasText: title(NAME.OKAFOR!) }).filter({ hasText: "Possible match" });
  await okafor.getByRole("button", { name: "Different people" }).click();
  await expect(okafor).toHaveCount(0);
  const brannigan = page.locator("section", { hasText: title(NAME.BRANNIGAN!) }).filter({ hasText: "Possible match" });
  await brannigan.getByRole("button", { name: "Same person — merge" }).click();
  await expect(brannigan).toHaveCount(0);

  // Screening queue: screen in the Winslow estate (grouped from two records)
  await nav("Screening").click();
  const winslowRow = page.getByRole("row", { name: new RegExp(NAME.WINSLOW!, "i") });
  await expect(winslowRow).toContainText("2 properties");
  await expect(winslowRow).toContainText("estate");
  await winslowRow.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Screen in/ }).click();
  await expect(page.getByText("1 case screened in.")).toBeVisible();

  // Pipeline search → case page
  await nav("Pipeline").click();
  await page.getByRole("textbox", { name: "Search" }).fill(title(NAME.WINSLOW!));
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("link", { name: new RegExp(`Harold P ${NAME.WINSLOW}`, "i") }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Estate of Harold P ${NAME.WINSLOW}`, "i") })).toBeVisible();
  await expect(page.getByText("Screened", { exact: true })).toBeVisible();
  await expect(page.getByText(/life insurance proceeds/).first()).toBeVisible();

  // The next move is blocked by a hard compliance guard
  const verify = page.locator("li", { hasText: "Move to Owner verified deceased" });
  await expect(verify.getByText(/cited source confirming the owner's death/)).toBeVisible();
  await expect(verify.getByText("(cannot be overridden)")).toBeVisible();
  await expect(verify.getByRole("button", { name: "Move to Owner verified deceased" })).toBeDisabled();
  await expect(page.getByText(/stage changed/).first()).toBeVisible();
});
