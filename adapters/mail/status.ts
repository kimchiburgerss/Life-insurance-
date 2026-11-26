/**
 * Configuration status for the Settings page and checklist. Deliberately does
 * NOT import any provider, so screens can show it without being able to send.
 */
export function mailProviderStatus(): { ok: boolean; name: string } {
  if ((process.env.MOCK_MODE ?? "true") !== "false") return { ok: true, name: "Mock mail (MOCK_MODE) — nothing is printed" };
  if (!process.env.LOB_API_KEY) return { ok: false, name: "No mail service configured (set LOB_API_KEY)" };
  return { ok: true, name: process.env.LOB_API_KEY.startsWith("test_") ? "Lob (test key — not mailed)" : "Lob (live)" };
}
