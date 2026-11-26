/**
 * Payments interface (build spec §3: Stripe invoicing + adapter + mock). ONLY
 * lib/billing/gateway.ts may import the providers (enforced by
 * tests/unit/no-send-without-approval.test.ts).
 */
export type InvoiceRequest = {
  /** Our Invoice id — used for idempotency keys and metadata. */
  invoiceId: string;
  customer: { name: string; email: string };
  amountCents: number;
  currency: string;
  description: string;
  daysUntilDue: number;
};

export type InvoiceResult = { providerInvoiceId: string; customerId: string | null; hostedUrl: string | null; dueDate: string | null };

export interface PaymentsProvider {
  readonly id: string;
  readonly name: string;
  sendInvoice(req: InvoiceRequest): Promise<InvoiceResult>;
  /** Re-send the invoice email for an open invoice (the 7/14/30-day reminders). */
  sendReminder(providerInvoiceId: string): Promise<void>;
  voidInvoice(providerInvoiceId: string): Promise<void>;
}
