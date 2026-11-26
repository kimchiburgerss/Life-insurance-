/**
 * E-signature vendor interface (build spec §3: ESignProvider). ONLY
 * lib/agreements/gateway.ts may import the providers — enforced by
 * tests/unit/no-send-without-approval.test.ts.
 */
export type SignatureRequest = {
  /** Our Agreement id (sent as metadata; also used to make retries safe). */
  agreementId: string;
  title: string;
  subject: string;
  message: string;
  signer: { name: string; email: string };
  pdf: Uint8Array;
  fileName: string;
};

export type SignatureRequestResult = { requestId: string; detail: string };

export type ESignEventType = "SENT" | "VIEWED" | "SIGNED" | "ALL_SIGNED" | "DECLINED" | "CANCELED" | "BOUNCED" | "DOWNLOADABLE" | "OTHER";

export type ESignEvent = {
  /** Provider event id or a stable hash of (time, type, request) for idempotency. */
  eventId: string;
  type: ESignEventType;
  requestId: string;
  occurredAt: Date;
  detail?: string;
};

export interface ESignProvider {
  readonly id: string;
  readonly name: string;
  send(req: SignatureRequest): Promise<SignatureRequestResult>;
  /** The completed, signed PDF (after ALL_SIGNED / DOWNLOADABLE). */
  downloadSigned(requestId: string): Promise<Uint8Array>;
  cancel(requestId: string): Promise<void>;
}
