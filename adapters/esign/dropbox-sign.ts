/**
 * Dropbox Sign (formerly HelloSign) API v3 — non-embedded signing: Dropbox Sign
 * emails the heir a signing link. Signature/date fields are placed with text
 * tags drawn invisibly in our PDF ([sig|req|signer1], [date|req|signer1]).
 * DROPBOX_SIGN_TEST_MODE=true (default) creates watermarked, non-binding test
 * requests, available even on a free account.
 */
import type { ESignProvider, SignatureRequest, SignatureRequestResult } from "./types";

const API = "https://api.hellosign.com/v3";

export class DropboxSignProvider implements ESignProvider {
  readonly id = "dropbox-sign";
  readonly name: string;

  constructor(
    private readonly apiKey: string,
    private readonly testMode: boolean,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = `Dropbox Sign${testMode ? " (test mode — not legally binding)" : ""}`;
  }

  private auth() {
    return { Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}` };
  }

  async send(req: SignatureRequest): Promise<SignatureRequestResult> {
    const form = new FormData();
    form.set("title", req.title.slice(0, 255));
    form.set("subject", req.subject.slice(0, 255));
    form.set("message", req.message.slice(0, 5000));
    form.set("signers[0][name]", req.signer.name);
    form.set("signers[0][email_address]", req.signer.email);
    form.set("use_text_tags", "1");
    form.set("hide_text_tags", "1");
    form.set("test_mode", this.testMode ? "1" : "0");
    form.set("metadata[agreement_id]", req.agreementId);
    form.set("files[0]", new Blob([new Uint8Array(req.pdf)], { type: "application/pdf" }), req.fileName);
    const res = await this.fetchImpl(`${API}/signature_request/send`, { method: "POST", headers: this.auth(), body: form, signal: AbortSignal.timeout(60_000) });
    const body = (await res.json().catch(() => ({}))) as { signature_request?: { signature_request_id?: string }; error?: { error_msg?: string } };
    const id = body.signature_request?.signature_request_id;
    if (!res.ok || !id) throw new Error(`Dropbox Sign rejected the request (${res.status}): ${body.error?.error_msg ?? "no details"}`);
    return { requestId: id, detail: `Dropbox Sign emailed ${req.signer.email} a signing link.` };
  }

  async downloadSigned(requestId: string): Promise<Uint8Array> {
    const res = await this.fetchImpl(`${API}/signature_request/files/${encodeURIComponent(requestId)}?file_type=pdf`, { headers: this.auth(), signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Dropbox Sign file download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async cancel(requestId: string): Promise<void> {
    const res = await this.fetchImpl(`${API}/signature_request/cancel/${encodeURIComponent(requestId)}`, { method: "POST", headers: this.auth(), signal: AbortSignal.timeout(30_000) });
    if (!res.ok && res.status !== 404) throw new Error(`Dropbox Sign cancel failed (${res.status})`);
  }
}
