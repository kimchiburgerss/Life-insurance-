/**
 * Lob letters API (https://docs.lob.com). One POST per letter:
 *  - use_type "marketing": the letter offers a paid service (required field);
 *  - mail_type "usps_first_class": undeliverable First-Class mail comes back,
 *    so we learn when an address is wrong (letter.returned_to_sender webhook);
 *  - address_placement "top_first_page": Lob prints both addresses in the blank
 *    zone our HTML leaves at the top of page 1 (shown through the window);
 *  - Idempotency-Key = our Communication id, so a retry never mails twice.
 */
import type { LetterRequest, LetterResult, MailProvider } from "./types";

const LOB_API = "https://api.lob.com/v1/letters";

function lobAddress(a: LetterRequest["to"]) {
  return {
    name: a.name.slice(0, 40),
    address_line1: a.line1.slice(0, 64),
    ...(a.line2 ? { address_line2: a.line2.slice(0, 64) } : {}),
    address_city: a.city,
    address_state: a.state,
    address_zip: a.zip,
    address_country: "US",
  };
}

export class LobMailProvider implements MailProvider {
  readonly id = "lob";
  readonly name = "Lob";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendLetter(req: LetterRequest): Promise<LetterResult> {
    const res = await this.fetchImpl(LOB_API, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": req.idempotencyKey,
      },
      body: JSON.stringify({
        description: req.description.slice(0, 255),
        to: lobAddress(req.to),
        from: lobAddress(req.from),
        file: req.html,
        color: false,
        double_sided: true,
        use_type: "marketing",
        mail_type: "usps_first_class",
        address_placement: "top_first_page",
        metadata: req.metadata,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; expected_delivery_date?: string; error?: { message?: string } };
    if (!res.ok || !body.id) {
      throw new Error(`Lob rejected the letter (${res.status}): ${body.error?.message ?? "no details"}`);
    }
    return { providerMessageId: body.id, expectedDeliveryDate: body.expected_delivery_date ?? null };
  }
}
