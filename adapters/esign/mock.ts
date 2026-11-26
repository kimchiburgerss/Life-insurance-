import { createHash } from "node:crypto";
import { PDFDocument, rgb, StandardFonts } from "@cantoo/pdf-lib";
import type { ESignProvider, SignatureRequest, SignatureRequestResult } from "./types";

type Stored = { req: SignatureRequest; signedAt: Date | null; cancelled: boolean };
const globalStore = globalThis as unknown as { mockEsign?: Map<string, Stored> };

/** Keeps signature requests in memory; the heir portal's demo "Sign" button completes them (MOCK_MODE only). */
export class MockESignProvider implements ESignProvider {
  readonly id = "mock-esign";
  readonly name = "Mock e-signature (demo — not legally binding)";

  static get store(): Map<string, Stored> {
    globalStore.mockEsign ??= new Map();
    return globalStore.mockEsign;
  }

  async send(req: SignatureRequest): Promise<SignatureRequestResult> {
    const requestId = `mock_sr_${createHash("sha256").update(req.agreementId).digest("hex").slice(0, 16)}`;
    MockESignProvider.store.set(requestId, { req, signedAt: null, cancelled: false });
    return { requestId, detail: "Mock signature request created; the heir signs in the portal (demo)." };
  }

  /** Demo only: record the heir's signature. */
  static markSigned(requestId: string, at = new Date()) {
    const s = MockESignProvider.store.get(requestId);
    if (s) s.signedAt = at;
  }

  async downloadSigned(requestId: string): Promise<Uint8Array> {
    const s = MockESignProvider.store.get(requestId);
    if (!s) throw new Error("Unknown mock signature request (the server restarted?)");
    const doc = await PDFDocument.load(s.req.pdf);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const last = doc.getPages().at(-1)!;
    last.drawText(`Signed electronically by ${s.req.signer.name} on ${(s.signedAt ?? new Date()).toISOString().slice(0, 10)} (DEMO — not legally binding)`, {
      x: 64,
      y: 48,
      size: 9,
      font,
      color: rgb(0.1, 0.35, 0.1),
    });
    return doc.save({ useObjectStreams: false });
  }

  async cancel(requestId: string): Promise<void> {
    const s = MockESignProvider.store.get(requestId);
    if (s) s.cancelled = true;
  }
}
