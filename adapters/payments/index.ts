import "server-only";
import { MockPaymentsProvider } from "./mock";
import { StripePaymentsProvider } from "./stripe";
import type { PaymentsProvider } from "./types";

export type { InvoiceRequest, PaymentsProvider } from "./types";
export { MockPaymentsProvider };

/** Mock in MOCK_MODE; Stripe when STRIPE_SECRET_KEY is set; otherwise none (manual invoices still work). */
export function getPaymentsProvider(): PaymentsProvider | null {
  if ((process.env.MOCK_MODE ?? "true") !== "false") return new MockPaymentsProvider();
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new StripePaymentsProvider(key) : null;
}
