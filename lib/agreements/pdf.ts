/**
 * Markdown → PDF for agreements, with pdf-lib (pure; no network, no files).
 * Supports what agreement templates need: headings, paragraphs with bold and
 * italics, bullet and numbered lists, rules. Adds page numbers, a reference,
 * the DRAFT marking on every page when the template is not attorney-approved,
 * and the signature block. E-sign text tags ([sig|req|signer1]) are drawn
 * invisibly where the heir signs; the provider hides them and places fields.
 */
import { PDFDocument, rgb, StandardFonts, degrees, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { marked, type Token, type Tokens } from "marked";

export class AgreementPdfError extends Error {}

/** Characters the standard PDF fonts (WinAnsi) can print. */
const WIN_ANSI = /^[\n\x20-\x7E\xA0-\xFFŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]*$/;

export function assertPrintable(label: string, value: string) {
  if (!WIN_ANSI.test(value)) {
    const bad = [...value].filter((ch) => !WIN_ANSI.test(ch));
    throw new AgreementPdfError(`${label} contains characters the agreement font cannot print (${[...new Set(bad)].join(" ")}). Correct the spelling before generating.`);
  }
}

type Run = { text: string; bold: boolean; italic: boolean };

function inlineRuns(tokens: Token[] | undefined, bold = false, italic = false): Run[] {
  const out: Run[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong":
        out.push(...inlineRuns((t as Tokens.Strong).tokens, true, italic));
        break;
      case "em":
        out.push(...inlineRuns((t as Tokens.Em).tokens, bold, true));
        break;
      case "link":
        out.push(...inlineRuns((t as Tokens.Link).tokens, bold, italic));
        break;
      case "br":
        out.push({ text: "\n", bold, italic });
        break;
      case "text":
      case "escape":
      case "codespan":
        if ("tokens" in t && Array.isArray(t.tokens) && t.tokens.length) out.push(...inlineRuns(t.tokens as Token[], bold, italic));
        else out.push({ text: (t as Tokens.Text).text, bold, italic });
        break;
      default:
        if ("text" in t && typeof t.text === "string") out.push({ text: t.text, bold, italic });
    }
  }
  return out;
}

export type SignatureBlock = {
  businessName: string;
  businessSigner: string;
  businessSignerTitle: string;
  businessSignedDate: string;
  heirName: string;
};

export type RenderOptions = {
  title: string;
  markdown: string;
  draft: boolean;
  reference: string;
  signature: SignatureBlock;
  createdAt: Date;
};

const PAGE = { w: 612, h: 792, margin: 64, top: 72, bottom: 64 };
const SIZE = { body: 10.5, h1: 16, h2: 12, small: 8 };
const LEADING = 1.38;

export async function renderAgreementPdf(opts: RenderOptions): Promise<{ bytes: Uint8Array; text: string; pages: number }> {
  assertPrintable("The agreement text", opts.markdown);
  for (const [k, v] of Object.entries(opts.signature)) assertPrintable(k, v);

  const doc = await PDFDocument.create();
  doc.setTitle(opts.title);
  doc.setProducer("Heir Finder");
  doc.setCreator("Heir Finder");
  doc.setCreationDate(opts.createdAt);
  doc.setModificationDate(opts.createdAt);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const fontFor = (r: { bold: boolean; italic: boolean }) => (r.bold ? (r.italic ? fonts.boldItalic : fonts.bold) : r.italic ? fonts.italic : fonts.regular);
  const textLines: string[] = [];
  if (opts.draft) textLines.push(`*** ${DRAFT_LABEL} ***`);

  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.top;
  const width = PAGE.w - PAGE.margin * 2;
  const newPage = () => {
    page = doc.addPage([PAGE.w, PAGE.h]);
    y = PAGE.h - PAGE.top;
  };
  const ensure = (h: number) => {
    if (y - h < PAGE.bottom) newPage();
  };

  /** Lay out runs with word wrap; returns plain text. */
  const paragraph = (runs: Run[], size: number, indent = 0, prefix?: string): string => {
    const lineH = size * LEADING;
    // Chunks = text between spaces; a chunk may mix fonts ("**Name**:") and never breaks.
    type Seg = { text: string; font: PDFFont };
    type Chunk = { segs: Seg[]; space: boolean; newline?: boolean; width: number };
    const chunks: Chunk[] = [];
    let cur: Seg[] = [];
    const pushCur = () => {
      if (cur.length) chunks.push({ segs: cur, space: false, width: cur.reduce((s, g) => s + g.font.widthOfTextAtSize(g.text, size), 0) });
      cur = [];
    };
    for (const r of runs) {
      for (const p of r.text.split(/(\s+)/)) {
        if (!p) continue;
        if (/\n/.test(p)) {
          pushCur();
          chunks.push({ segs: [], space: false, newline: true, width: 0 });
        } else if (/^\s+$/.test(p)) {
          pushCur();
          const f = fontFor(r);
          chunks.push({ segs: [{ text: " ", font: f }], space: true, width: f.widthOfTextAtSize(" ", size) });
        } else cur.push({ text: p, font: fontFor(r) });
      }
    }
    pushCur();
    const maxW = width - indent;
    let line: Chunk[] = [];
    let lineW = 0;
    const plain: string[] = [];
    let first = true;
    const flush = () => {
      while (line.length && line[line.length - 1]!.space) line.pop();
      ensure(lineH);
      if (prefix && first) page.drawText(prefix, { x: PAGE.margin + indent - fonts.regular.widthOfTextAtSize(prefix, size) - 4, y: y - size, size, font: fonts.regular });
      // Draw consecutive same-font text as one string so spacing is native.
      let x = PAGE.margin + indent;
      const segments: Seg[] = [];
      for (const g of line.flatMap((c) => c.segs)) {
        const last = segments[segments.length - 1];
        if (last && last.font === g.font) last.text += g.text;
        else segments.push({ ...g });
      }
      for (const seg of segments) {
        if (seg.text) page.drawText(seg.text, { x, y: y - size, size, font: seg.font, color: rgb(0.08, 0.08, 0.08) });
        x += seg.font.widthOfTextAtSize(seg.text, size);
      }
      plain.push(segments.map((g) => g.text).join(""));
      y -= lineH;
      line = [];
      lineW = 0;
      first = false;
    };
    for (const c of chunks) {
      if (c.newline) {
        flush();
        continue;
      }
      if (c.space && line.length === 0) continue;
      if (!c.space && lineW + c.width > maxW && line.length) flush();
      line.push(c);
      lineW += c.width;
    }
    if (line.length) flush();
    y -= size * 0.45;
    return (prefix ? `${prefix} ` : "") + plain.join(" ");
  };

  const tokens = marked.lexer(opts.markdown);
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        const size = h.depth === 1 ? SIZE.h1 : SIZE.h2;
        ensure(size * 3);
        y -= h.depth === 1 ? 0 : size * 0.4;
        textLines.push("", paragraph(inlineRuns(h.tokens, true), size).toUpperCase());
        break;
      }
      case "paragraph":
        textLines.push(paragraph(inlineRuns((t as Tokens.Paragraph).tokens), SIZE.body));
        break;
      case "list": {
        const l = t as Tokens.List;
        l.items.forEach((item, i) => {
          const inner = item.tokens.flatMap((x) => ("tokens" in x && Array.isArray(x.tokens) ? (x.tokens as Token[]) : [x]));
          textLines.push(paragraph(inlineRuns(inner), SIZE.body, 18, l.ordered ? `${Number(l.start || 1) + i}.` : "•"));
          y += SIZE.body * 0.3;
        });
        y -= SIZE.body * 0.3;
        break;
      }
      case "hr":
        ensure(12);
        page.drawLine({ start: { x: PAGE.margin, y: y - 4 }, end: { x: PAGE.w - PAGE.margin, y: y - 4 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) });
        y -= 14;
        break;
      case "space":
        break;
      default:
        if ("text" in t && typeof t.text === "string" && t.text.trim()) textLines.push(paragraph([{ text: t.text, bold: false, italic: false }], SIZE.body));
    }
  }

  // Signature block (always last; kept together on one page).
  ensure(230);
  y -= 10;
  textLines.push("", paragraph([{ text: "Signatures", bold: true, italic: false }], SIZE.h2));
  const s = opts.signature;
  const sigLine = (label: string, value: string, tag?: string) => {
    ensure(40);
    page.drawText(label, { x: PAGE.margin, y: y - SIZE.small, size: SIZE.small, font: fonts.regular, color: rgb(0.35, 0.35, 0.35) });
    y -= SIZE.small + 4;
    page.drawLine({ start: { x: PAGE.margin, y: y - 18 }, end: { x: PAGE.margin + 300, y: y - 18 }, thickness: 0.6, color: rgb(0.2, 0.2, 0.2) });
    if (value) page.drawText(value, { x: PAGE.margin + 2, y: y - 14, size: SIZE.body, font: fonts.italic });
    if (tag) page.drawText(tag, { x: PAGE.margin + 2, y: y - 14, size: 8, font: fonts.regular, color: rgb(1, 1, 1) });
    y -= 30;
    textLines.push(`${label}: ${value || "________________"}`);
  };
  textLines.push(`For ${s.businessName}:`);
  page.drawText(`For ${s.businessName}`, { x: PAGE.margin, y: y - SIZE.body, size: SIZE.body, font: fonts.bold });
  y -= SIZE.body * 1.8;
  sigLine("Signature", `/s/ ${s.businessSigner}`);
  sigLine("Name and title", `${s.businessSigner}${s.businessSignerTitle ? `, ${s.businessSignerTitle}` : ""}`);
  sigLine("Date", s.businessSignedDate);
  y -= 6;
  textLines.push(`${s.heirName} (you):`);
  page.drawText(`${s.heirName} (you)`, { x: PAGE.margin, y: y - SIZE.body, size: SIZE.body, font: fonts.bold });
  y -= SIZE.body * 1.8;
  sigLine("Signature", "", "[sig|req|signer1]");
  sigLine("Date", "", "[date|req|signer1]");

  // Footer, page numbers and DRAFT marking on every page.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const footer = `${opts.reference} · Page ${i + 1} of ${pages.length}`;
    p.drawText(footer, { x: PAGE.margin, y: 32, size: SIZE.small, font: fonts.regular, color: rgb(0.4, 0.4, 0.4) });
    if (opts.draft) {
      p.drawText(DRAFT_LABEL, { x: PAGE.margin, y: PAGE.h - 40, size: 9, font: fonts.bold, color: rgb(0.75, 0.05, 0.05) });
      p.drawText("DRAFT", { x: 150, y: 300, size: 110, font: fonts.bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(40) });
    }
  });
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, text: textLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), pages: pages.length };
}

const DRAFT_LABEL = "DRAFT — must be reviewed by a licensed attorney before use";
