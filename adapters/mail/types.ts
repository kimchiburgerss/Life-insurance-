/**
 * Print-and-mail vendor interface (build spec §3). ONLY lib/outreach/gateway.ts
 * may import this module's providers — tests/unit/no-send-without-approval.test.ts
 * fails the build if anything else does.
 */
export type MailAddress = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
};

export type LetterRequest = {
  /** Our Communication id — used as the vendor idempotency key so a retry never mails twice. */
  idempotencyKey: string;
  to: MailAddress;
  from: MailAddress;
  /** Complete letter HTML (8.5×11, blank address zone at the top of page 1). */
  html: string;
  description: string;
  metadata: Record<string, string>;
};

export type LetterResult = {
  providerMessageId: string;
  expectedDeliveryDate: string | null;
};

export interface MailProvider {
  readonly id: string;
  readonly name: string;
  sendLetter(req: LetterRequest): Promise<LetterResult>;
}
