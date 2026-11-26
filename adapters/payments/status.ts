/** Configuration status for screens. Deliberately does NOT import a provider. */
export function paymentsProviderStatus(): { ok: boolean; name: string; mock: boolean } {
  if ((process.env.MOCK_MODE ?? "true") !== "false") return { ok: true, name: "Mock invoicing (MOCK_MODE) — the heir pays with a demo button in the portal", mock: true };
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, name: "No payment service configured (set STRIPE_SECRET_KEY) — manual invoices only", mock: false };
  return { ok: true, name: key.startsWith("sk_test_") ? "Stripe (test mode)" : "Stripe (live)", mock: false };
}
