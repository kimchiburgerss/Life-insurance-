import { createHash } from "node:crypto";
import type { LetterRequest, LetterResult, MailProvider } from "./types";

/** Records letters in memory instead of mailing them (MOCK_MODE). */
export class MockMailProvider implements MailProvider {
  readonly id = "mock-mail";
  readonly name = "Mock mail (nothing is printed)";
  static sent: LetterRequest[] = [];

  async sendLetter(req: LetterRequest): Promise<LetterResult> {
    MockMailProvider.sent.push(req);
    const id = createHash("sha256").update(req.idempotencyKey).digest("hex").slice(0, 16);
    return { providerMessageId: `mock_ltr_${id}`, expectedDeliveryDate: null };
  }
}
