/**
 * Stripe webhooks (pure). Stripe-Signature: "t=<unix>,v1=<hex>[,v1=...]";
 * v1 = hex HMAC-SHA256(endpoint secret, `${t}.${raw body}`). Any v1 may match
 * (secret rotation); timestamps older than 5 minutes are refused.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now = Date.now(), toleranceSeconds = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return sigs.some((s) => {
    const b = Buffer.from(s);
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
}

export type StripeInvoiceEvent = { eventId: string; type: "PAID" | "VOIDED" | "UNCOLLECTIBLE" | "PAYMENT_FAILED" | "OTHER"; providerInvoiceId: string | null; invoiceId: string | null; occurredAt: Date };

export function parseStripeEvent(body: unknown): StripeInvoiceEvent | null {
  const e = body as { id?: string; type?: string; created?: number; data?: { object?: { id?: string; object?: string; metadata?: Record<string, string>; status_transitions?: { paid_at?: number | null } } } };
  if (!e?.id || !e.type) return null;
  const obj = e.data?.object;
  const map: Record<string, StripeInvoiceEvent["type"]> = {
    "invoice.paid": "PAID",
    "invoice.voided": "VOIDED",
    "invoice.marked_uncollectible": "UNCOLLECTIBLE",
    "invoice.payment_failed": "PAYMENT_FAILED",
  };
  const paidAt = obj?.status_transitions?.paid_at;
  return {
    eventId: e.id,
    type: map[e.type] ?? "OTHER",
    providerInvoiceId: obj?.object === "invoice" ? (obj.id ?? null) : null,
    invoiceId: obj?.metadata?.invoice_id ?? null,
    occurredAt: new Date(((paidAt ?? e.created) || Date.now() / 1000) * 1000),
  };
}
