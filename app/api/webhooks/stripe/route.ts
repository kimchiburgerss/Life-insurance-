import { applyStripeEvent } from "@/lib/billing/gateway";
import { parseStripeEvent, verifyStripeSignature } from "@/adapters/payments/webhook";

export const dynamic = "force-dynamic";

/** Stripe webhook endpoint (invoice.paid / voided / marked_uncollectible / payment_failed), signature-verified. */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "webhook not configured" }, { status: 503 });
  const rawBody = await request.text();
  if (rawBody.length > 512 * 1024) return Response.json({ error: "too large" }, { status: 413 });
  if (!verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), secret)) return Response.json({ error: "invalid signature" }, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const event = parseStripeEvent(body);
  if (event && event.type !== "OTHER") await applyStripeEvent(event);
  return Response.json({ received: true });
}
