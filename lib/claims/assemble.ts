/**
 * One ordered PDF for the claim (spec 5.8): a cover letter, then every
 * accepted document in checklist order. PDFs are copied page by page; JPEG and
 * PNG photos become pages scaled to fit; each enclosure page carries a small
 * footer naming the item. Pure: bytes in, bytes out.
 */
import { PDFDocument, rgb, StandardFonts } from "@cantoo/pdf-lib";
import { renderAgreementPdf } from "@/lib/agreements/pdf";

export class AssemblyError extends Error {}

export type Enclosure = { key: string; label: string; fileName: string; contentType: string; bytes: Uint8Array };

const LETTER: [number, number] = [612, 792];

export async function assemblePacket(input: { coverMarkdown: string; reference: string; enclosures: Enclosure[]; createdAt: Date }) {
  const cover = await renderAgreementPdf({ title: `Claim ${input.reference}`, markdown: input.coverMarkdown, draft: false, reference: input.reference, createdAt: input.createdAt });
  const out = await PDFDocument.create();
  out.setTitle(`Unclaimed property claim — ${input.reference}`);
  out.setProducer("Heir Finder");
  out.setCreationDate(input.createdAt);
  out.setModificationDate(input.createdAt);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const coverDoc = await PDFDocument.load(cover.bytes);
  for (const p of await out.copyPages(coverDoc, coverDoc.getPageIndices())) out.addPage(p);

  const manifest: { key: string; label: string; fileName: string; pages: number }[] = [];
  let n = 0;
  for (const e of input.enclosures) {
    n++;
    const footer = `Enclosure ${n}: ${e.label}`.replace(/[^\x20-\x7E]/g, "-").slice(0, 110);
    let pages = 0;
    if (e.contentType === "application/pdf") {
      let copied: Awaited<ReturnType<typeof out.copyPages>>;
      try {
        const src = await PDFDocument.load(e.bytes, { ignoreEncryption: false });
        if (src.getPageCount() === 0) throw new Error("no pages");
        copied = await out.copyPages(src, src.getPageIndices());
      } catch (err) {
        throw new AssemblyError(`"${e.fileName}" (${e.label}) could not be opened as a PDF${String(err).includes("ncrypt") ? " — it is password-protected" : ""}. Ask for a new copy.`);
      }
      for (const p of copied) {
        const page = out.addPage(p);
        page.drawText(footer, { x: 24, y: 10, size: 7, font, color: rgb(0.35, 0.35, 0.35) });
        pages++;
      }
    } else if (e.contentType === "image/jpeg" || e.contentType === "image/png") {
      const img = e.contentType === "image/jpeg" ? await out.embedJpg(e.bytes) : await out.embedPng(e.bytes);
      const page = out.addPage(LETTER);
      const maxW = LETTER[0] - 72;
      const maxH = LETTER[1] - 96;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1.5);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (LETTER[0] - w) / 2, y: (LETTER[1] - h) / 2 + 8, width: w, height: h });
      page.drawText(footer, { x: 24, y: 10, size: 7, font, color: rgb(0.35, 0.35, 0.35) });
      pages = 1;
    } else {
      throw new AssemblyError(`"${e.fileName}" (${e.label}) is a ${e.contentType} file, which can't go into the packet. Ask the heir for a PDF or JPEG.`);
    }
    manifest.push({ key: e.key, label: e.label, fileName: e.fileName, pages });
  }
  const bytes = await out.save({ useObjectStreams: false });
  return { bytes, pages: out.getPageCount(), manifest, coverText: cover.text };
}
