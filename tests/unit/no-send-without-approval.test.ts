/**
 * Compliance rule 7 — structural half of the proof that no code path can send
 * outreach without an approval record. The runtime half is in
 * tests/integration/outreach.test.ts (gateway refusals + database triggers).
 *
 * 1. Only lib/outreach/gateway.ts may import a mail or email PROVIDER (or
 *    nodemailer). Status helpers (adapters/<x>/status.ts) cannot send.
 * 2. Only the gateway may call a provider's send method.
 * 3. Only the gateway may set an outbound message to QUEUED/SENT/DELIVERED
 *    (the Lob webhook may record DELIVERED/RETURNED for already-sent letters).
 * 4. Nothing outside the adapters talks to a mail/email API directly.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["app", "lib", "adapters", "scripts", "prisma", "components", "proxy.ts", "instrumentation.ts"];
const GATEWAY = "lib/outreach/gateway.ts";
const AGREEMENT_GATEWAY = "lib/agreements/gateway.ts";

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      if (p.includes("generated") || p.endsWith("node_modules") || p.includes(`${path.sep}migrations`)) return;
      for (const f of readdirSync(p)) walk(path.join(p, f));
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(p)) {
      out.push(p.split(path.sep).join("/"));
    }
  };
  ROOTS.forEach(walk);
  return out;
}

const files = sourceFiles().map((f) => ({ file: f, text: readFileSync(f, "utf8") }));

const PROVIDER_IMPORT = /from\s+["'](?:@\/adapters\/(?:mail|email)(?:\/(?:index|lob|mock|smtp))?|nodemailer)["']|import\(\s*["'](?:@\/adapters\/(?:mail|email)(?:\/(?:index|lob|mock|smtp))?|nodemailer)["']\s*\)/;

describe("rule 7 — the send gateway is the only way out", () => {
  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.file === GATEWAY)).toBe(true);
  });

  it("only the gateway imports a mail/email provider", () => {
    const offenders = files
      .filter((f) => !f.file.startsWith("adapters/mail/") && !f.file.startsWith("adapters/email/"))
      .filter((f) => PROVIDER_IMPORT.test(f.text))
      .map((f) => f.file);
    expect(offenders).toEqual([GATEWAY]);
  });

  it("inside the adapters, nodemailer is used only by the SMTP provider", () => {
    const users = files.filter((f) => /from\s+["']nodemailer["']/.test(f.text)).map((f) => f.file);
    expect(users).toEqual(["adapters/email/smtp.ts"]);
  });

  it("only the gateway calls a provider's send method", () => {
    const offenders = files
      .filter((f) => f.file !== GATEWAY && !f.file.startsWith("adapters/"))
      .filter((f) => /\.sendLetter\(|\.sendMail\(|getMailProvider\(|getEmailProvider\(/.test(f.text))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("only the gateway marks outbound messages queued or sent", () => {
    const offenders = files
      .filter((f) => f.file !== GATEWAY && f.file !== "prisma/seed.ts")
      .filter((f) => /\.communication\.(?:update|updateMany|upsert|create|createMany)\(/.test(f.text) && /status:\s*["'](?:QUEUED|SENT)["']/.test(f.text))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("no code outside the adapters calls a mail or email API directly", () => {
    const offenders = files
      .filter((f) => !f.file.startsWith("adapters/"))
      .filter((f) => /api\.lob\.com|smtp\.|createTransport\(/.test(f.text))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("only the agreement gateway imports an e-signature provider", () => {
    const ESIGN_IMPORT = /from\s+["']@\/adapters\/esign(?:\/(?:index|mock|dropbox-sign))?["']|import\(\s*["']@\/adapters\/esign(?:\/(?:index|mock|dropbox-sign))?["']\s*\)/;
    const offenders = files.filter((f) => !f.file.startsWith("adapters/esign/")).filter((f) => ESIGN_IMPORT.test(f.text)).map((f) => f.file);
    expect(offenders).toEqual([AGREEMENT_GATEWAY]);
  });

  it("only the agreement gateway calls the e-signature API or marks an agreement sent", () => {
    const api = files.filter((f) => !f.file.startsWith("adapters/")).filter((f) => /api\.hellosign\.com|getESignProvider\(/.test(f.text) && f.file !== AGREEMENT_GATEWAY).map((f) => f.file);
    expect(api).toEqual([]);
    const sent = files
      .filter((f) => f.file !== AGREEMENT_GATEWAY)
      .filter((f) => /\.agreement\.(?:update|updateMany|create)\(/.test(f.text) && /status:\s*["']SENT["']/.test(f.text))
      .map((f) => f.file);
    expect(sent).toEqual([]);
  });

  it("approvals are created only by the outreach and agreement services (and the demo seed's shortcut)", () => {
    const offenders = files
      .filter((f) => !["lib/outreach/service.ts", "lib/agreements/service.ts", "prisma/seed.ts"].includes(f.file))
      .filter((f) => /\.approval\.create\(/.test(f.text))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });
});
