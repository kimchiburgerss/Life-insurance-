import { createHash } from "node:crypto";
import type { InvoiceRequest, InvoiceResult, PaymentsProvider } from "./types";

const g = globalThis as unknown as { mockInvoices?: Map<string, { req: InvoiceRequest; reminders: number; voided: boolean }> };

/** In-memory invoices (MOCK_MODE); the heir "pays" with the portal's demo button. */
export class MockPaymentsProvider implements PaymentsProvider {
  readonly id = "mock-payments";
  readonly name = "Mock invoicing (demo — no money moves)";

  static get store() {
    g.mockInvoices ??= new Map();
    return g.mockInvoices;
  }

  async sendInvoice(req: InvoiceRequest): Promise<InvoiceResult> {
    const id = `mock_in_${createHash("sha256").update(req.invoiceId).digest("hex").slice(0, 16)}`;
    MockPaymentsProvider.store.set(id, { req, reminders: 0, voided: false });
    const due = new Date(Date.now() + req.daysUntilDue * 86_400_000).toISOString().slice(0, 10);
    return { providerInvoiceId: id, customerId: `mock_cus_${id.slice(8, 16)}`, hostedUrl: null, dueDate: due };
  }

  async sendReminder(providerInvoiceId: string): Promise<void> {
    const s = MockPaymentsProvider.store.get(providerInvoiceId);
    if (s) s.reminders++;
  }

  async voidInvoice(providerInvoiceId: string): Promise<void> {
    const s = MockPaymentsProvider.store.get(providerInvoiceId);
    if (s) s.voided = true;
  }
}
