import "server-only";
import { MockEmailProvider } from "./mock";
import { SmtpEmailProvider } from "./smtp";
import type { EmailProvider } from "./types";

export type { EmailProvider, EmailRequest, EmailResult } from "./types";

function smtpConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(SMTP_PORT || 587);
  return { host: SMTP_HOST, port, secure: SMTP_SECURE ? SMTP_SECURE === "true" : port === 465, user: SMTP_USER, pass: SMTP_PASS };
}

/** Mock in MOCK_MODE; SMTP when SMTP_HOST/USER/PASS are set; otherwise none (sending is blocked). */
export function getEmailProvider(): EmailProvider | null {
  if ((process.env.MOCK_MODE ?? "true") !== "false") return new MockEmailProvider();
  const cfg = smtpConfig();
  return cfg ? new SmtpEmailProvider(cfg) : null;
}
