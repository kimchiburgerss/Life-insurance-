/**
 * Configuration status for screens. Deliberately does NOT import a provider.
 */
export function esignProviderStatus(): { ok: boolean; name: string; mock: boolean } {
  if ((process.env.MOCK_MODE ?? "true") !== "false") return { ok: true, name: "Mock e-signature (MOCK_MODE) — the heir signs in the demo portal", mock: true };
  if (!process.env.DROPBOX_SIGN_API_KEY) return { ok: false, name: "No e-signature service configured (set DROPBOX_SIGN_API_KEY) — paper signing only", mock: false };
  return { ok: true, name: process.env.DROPBOX_SIGN_TEST_MODE === "false" ? "Dropbox Sign (live)" : "Dropbox Sign (test mode — not legally binding)", mock: false };
}
