/**
 * Email over SMTP from the founder's own business mailbox (Google Workspace,
 * Microsoft 365, or any SMTP host). Transactional email services generally
 * prohibit unsolicited outreach, so one-to-one emails from a real mailbox are
 * the honest fit — see ASSUMPTIONS.md. Keep volume low and follow your mail
 * host's sending limits and terms.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type { EmailProvider, EmailRequest, EmailResult } from "./types";

export type SmtpConfig = { host: string; port: number; secure: boolean; user: string; pass: string };

export class SmtpEmailProvider implements EmailProvider {
  readonly id = "smtp";
  readonly name: string;
  private readonly transport: Transporter;

  constructor(config: SmtpConfig) {
    this.name = `SMTP (${config.host})`;
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      requireTLS: !config.secure,
    });
  }

  async send(req: EmailRequest): Promise<EmailResult> {
    const info = await this.transport.sendMail({
      from: { name: req.from.name, address: req.from.address },
      to: { name: req.to.name, address: req.to.address },
      replyTo: req.replyTo,
      subject: req.subject,
      html: req.html,
      text: req.text,
      headers: req.headers,
    });
    return { providerMessageId: info.messageId };
  }
}
