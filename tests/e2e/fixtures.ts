/**
 * Shared test fixtures:
 * - every test fails if the browser reports a Content-Security-Policy or
 *   framing violation (proxy.ts, next.config.ts headers);
 * - expectAccessible() runs axe-core with the WCAG 2.0/2.1/2.2 A and AA rules.
 */
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

const SECURITY_MESSAGE = /Refused to|Content Security Policy|violates the following/i;

export function watchSecurityConsole(context: BrowserContext, problems: string[]) {
  const watch = (p: Page) =>
    p.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warning") && SECURITY_MESSAGE.test(m.text())) problems.push(`${p.url()}: ${m.text()}`);
    });
  context.pages().forEach(watch);
  context.on("page", watch);
}

export const test = base.extend<{ securityConsole: string[] }>({
  securityConsole: [
    async ({ context }, use) => {
      const problems: string[] = [];
      watchSecurityConsole(context, problems);
      await use(problems);
      expect(problems, "CSP or framing violations in the browser console").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectAccessible(page: Page, where: string, opts: { soft?: boolean } = {}) {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .exclude("nextjs-portal") // Next.js dev-tools badge (development only)
    // The letter preview is a sandboxed iframe (no scripts allowed, so axe can't
    // run inside it); it shows a printed letter, not part of the app's UI.
    .exclude('iframe[title="Letter preview"]')
    .analyze();
  const violations = results.violations.map(
    (v) => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`,
  );
  (opts.soft ? expect.soft : expect)(violations, `accessibility problems on ${where}`).toEqual([]);
}
export type { Page } from "@playwright/test";
