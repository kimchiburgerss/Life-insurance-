/**
 * Email sending interface. ONLY lib/outreach/gateway.ts may import this
 * module's providers (enforced by tests/unit/no-send-without-approval.test.ts).
 */
export type EmailRequest = {
  from: { name: string; address: string };
  to: { name: string; address: string };
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  /** e.g. List-Unsubscribe / List-Unsubscribe-Post (RFC 8058 one-click). */
  headers: Record<string, string>;
};

export type EmailResult = { providerMessageId: string };

export interface EmailProvider {
  readonly id: string;
  readonly name: string;
  send(req: EmailRequest): Promise<EmailResult>;
}
