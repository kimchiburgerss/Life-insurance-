/**
 * Lob delivery events. Lob signs each webhook: Lob-Signature is the hex
 * HMAC-SHA256 of `${Lob-Signature-Timestamp}.${raw body}` keyed with the
 * webhook's secret. Unsigned, mis-signed or stale requests are rejected before
 * anything is read from the body.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLobSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  const { rawBody, timestamp, signature, secret } = input;
  if (!timestamp || !signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  // Freshness: accept seconds or milliseconds since the epoch.
  const ts = Number(timestamp);
  if (Number.isFinite(ts) && ts > 0) {
    const tsMs = ts > 1e12 ? ts : ts * 1000;
    const now = input.now ?? Date.now();
    if (Math.abs(now - tsMs) > (input.toleranceSeconds ?? 300) * 1000) return false;
  } else {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed) && Math.abs((input.now ?? Date.now()) - parsed) > (input.toleranceSeconds ?? 300) * 1000) return false;
  }
  return true;
}

export type LobEvent = { id: string; eventType: string; letterId: string | null; dateCreated: string | null };

export function parseLobEvent(body: unknown): LobEvent | null {
  if (!body || typeof body !== "object") return null;
  const o = body as { id?: unknown; event_type?: { id?: unknown }; body?: { id?: unknown }; date_created?: unknown };
  if (typeof o.id !== "string" || typeof o.event_type?.id !== "string") return null;
  return {
    id: o.id,
    eventType: o.event_type.id,
    letterId: typeof o.body?.id === "string" ? o.body.id : null,
    dateCreated: typeof o.date_created === "string" ? o.date_created : null,
  };
}

/** What a Lob letter event means for our record. */
export function interpretLobEvent(eventType: string): { status?: "DELIVERED" | "RETURNED"; deliveryStatus: string } {
  switch (eventType) {
    case "letter.processed_for_delivery":
    case "letter.delivered":
      return { status: "DELIVERED", deliveryStatus: eventType.replace("letter.", "").replace(/_/g, " ") };
    case "letter.returned_to_sender":
      return { status: "RETURNED", deliveryStatus: "returned to sender" };
    default:
      return { deliveryStatus: eventType.replace(/^letter\./, "").replace(/[_.-]/g, " ") };
  }
}
