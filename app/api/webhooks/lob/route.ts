import { applyLobEvent } from "@/lib/outreach/delivery";
import { parseLobEvent, verifyLobSignature } from "@/lib/outreach/webhooks";

export const dynamic = "force-dynamic";

/**
 * Lob delivery-tracking webhook. Public URL, so the signature is the only
 * credential: anything unsigned, mis-signed or stale gets 401 and is ignored.
 */
export async function POST(request: Request) {
  const secret = process.env.LOB_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "webhook not configured" }, { status: 503 });
  const rawBody = await request.text();
  if (rawBody.length > 256 * 1024) return Response.json({ error: "too large" }, { status: 413 });
  const ok = verifyLobSignature({
    rawBody,
    timestamp: request.headers.get("lob-signature-timestamp"),
    signature: request.headers.get("lob-signature"),
    secret,
  });
  if (!ok) return Response.json({ error: "invalid signature" }, { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const event = parseLobEvent(body);
  if (!event) return Response.json({ ok: true, ignored: true });
  const result = await applyLobEvent(event);
  return Response.json({ ok: true, handled: result.handled });
}
