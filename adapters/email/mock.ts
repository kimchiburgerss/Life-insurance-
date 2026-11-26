import { createHash } from "node:crypto";
import type { EmailProvider, EmailRequest, EmailResult } from "./types";

/** Records emails in memory instead of sending them (MOCK_MODE). */
export class MockEmailProvider implements EmailProvider {
  readonly id = "mock-email";
  readonly name = "Mock email (nothing is sent)";
  static sent: EmailRequest[] = [];

  async send(req: EmailRequest): Promise<EmailResult> {
    MockEmailProvider.sent.push(req);
    const id = createHash("sha256").update(`${req.to.address}|${req.subject}|${req.text}`).digest("hex").slice(0, 16);
    return { providerMessageId: `<mock-${id}@mock.invalid>` };
  }
}
