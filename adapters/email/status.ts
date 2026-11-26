/**
 * Configuration status for the Settings page and checklist. Deliberately does
 * NOT import any provider, so screens can show it without being able to send.
 */
function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function emailProviderStatus(): { ok: boolean; name: string } {
  if ((process.env.MOCK_MODE ?? "true") !== "false") return { ok: true, name: "Mock email (MOCK_MODE) — nothing is sent" };
  return smtpConfigured()
    ? { ok: true, name: `SMTP via ${process.env.SMTP_HOST}` }
    : { ok: false, name: "No email service configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)" };
}
