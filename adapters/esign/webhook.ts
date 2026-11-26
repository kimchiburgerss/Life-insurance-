/**
 * Dropbox Sign callbacks: POST multipart/form-data with the event JSON in the
 * "json" field. event_hash = hex HMAC-SHA256(key = API key, message =
 * event_time + event_type). The endpoint must answer "Hello API Event Received".
 * Pure — no network.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ESignEvent, ESignEventType } from "./types";

export const DROPBOX_SIGN_ACK = "Hello API Event Received";

type Payload = {
  event?: { event_time?: string; event_type?: string; event_hash?: string; event_metadata?: { related_signature_id?: string } };
  signature_request?: { signature_request_id?: string; metadata?: Record<string, string> };
};

export function verifyDropboxSignEvent(payload: Payload, apiKey: string): boolean {
  const e = payload.event;
  if (!e?.event_time || !e.event_type || !e.event_hash || !apiKey) return false;
  const expected = createHmac("sha256", apiKey).update(`${e.event_time}${e.event_type}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(e.event_hash).toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

const MAP: Record<string, ESignEventType> = {
  signature_request_sent: "SENT",
  signature_request_viewed: "VIEWED",
  signature_request_signed: "SIGNED",
  signature_request_all_signed: "ALL_SIGNED",
  signature_request_downloadable: "DOWNLOADABLE",
  signature_request_declined: "DECLINED",
  signature_request_canceled: "CANCELED",
  signature_request_email_bounce: "BOUNCED",
};

export function parseDropboxSignEvent(payload: Payload): (ESignEvent & { agreementId: string | null }) | null {
  const e = payload.event;
  const requestId = payload.signature_request?.signature_request_id;
  if (!e?.event_type || !e.event_time || !requestId) return null;
  const seconds = Number(e.event_time);
  return {
    eventId: createHash("sha256").update(`${e.event_time}|${e.event_type}|${requestId}|${e.event_metadata?.related_signature_id ?? ""}`).digest("hex").slice(0, 32),
    type: MAP[e.event_type] ?? "OTHER",
    requestId,
    occurredAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(),
    detail: e.event_type,
    agreementId: payload.signature_request?.metadata?.agreement_id ?? null,
  };
}
