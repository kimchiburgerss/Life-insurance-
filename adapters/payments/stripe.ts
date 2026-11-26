/**
 * Stripe Invoicing over its REST API (form-encoded; no SDK needed):
 *   customer → draft invoice (collection_method=send_invoice, days_until_due)
 *   → invoice item attached to that invoice → finalize → send (Stripe emails
 *   the heir a hosted payment page). Every call carries an Idempotency-Key
 *   derived from our invoice id, so a retry never creates a second invoice.
 */
import type { InvoiceRequest, InvoiceResult, PaymentsProvider } from "./types";

const API = "https://api.stripe.com/v1";

function form(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export class StripePaymentsProvider implements PaymentsProvider {
  readonly id = "stripe";
  readonly name: string;

  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = secretKey.startsWith("sk_test_") ? "Stripe (test mode)" : "Stripe (live)";
  }

  private async call<T>(path: string, params: Record<string, string | number | undefined>, idempotencyKey?: string): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: form(params),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe ${path} failed (${res.status}): ${body.error?.message ?? "no details"}`);
    return body;
  }

  async sendInvoice(req: InvoiceRequest): Promise<InvoiceResult> {
    const key = (step: string) => `heirfinder-${req.invoiceId}-${step}`;
    const customer = await this.call<{ id: string }>("/customers", { name: req.customer.name, email: req.customer.email, "metadata[invoice_id]": req.invoiceId }, key("customer"));
    const invoice = await this.call<{ id: string }>(
      "/invoices",
      {
        customer: customer.id,
        collection_method: "send_invoice",
        days_until_due: req.daysUntilDue,
        currency: req.currency,
        description: req.description.slice(0, 500),
        pending_invoice_items_behavior: "exclude",
        "metadata[invoice_id]": req.invoiceId,
      },
      key("invoice"),
    );
    await this.call("/invoiceitems", { customer: customer.id, invoice: invoice.id, amount: req.amountCents, currency: req.currency, description: req.description.slice(0, 500) }, key("item"));
    await this.call(`/invoices/${invoice.id}/finalize`, { auto_advance: "false" }, key("finalize"));
    const sent = await this.call<{ id: string; hosted_invoice_url?: string | null; due_date?: number | null }>(`/invoices/${invoice.id}/send`, {}, key("send"));
    return {
      providerInvoiceId: sent.id,
      customerId: customer.id,
      hostedUrl: sent.hosted_invoice_url ?? null,
      dueDate: sent.due_date ? new Date(sent.due_date * 1000).toISOString().slice(0, 10) : null,
    };
  }

  async sendReminder(providerInvoiceId: string): Promise<void> {
    await this.call(`/invoices/${providerInvoiceId}/send`, {});
  }

  async voidInvoice(providerInvoiceId: string): Promise<void> {
    await this.call(`/invoices/${providerInvoiceId}/void`, {}, `heirfinder-void-${providerInvoiceId}`);
  }
}
