/**
 * Identify an uploaded file by its first bytes (never trust the browser's
 * MIME type or the file name). Only formats heirs need for claim documents:
 * PDF scans and phone photos.
 */
export type SniffedType = { contentType: string; ext: string; label: string };

const ACCEPTED: { test: (b: Uint8Array) => boolean; type: SniffedType }[] = [
  { test: (b) => ascii(b, 0, 5) === "%PDF-", type: { contentType: "application/pdf", ext: "pdf", label: "PDF" } },
  { test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, type: { contentType: "image/jpeg", ext: "jpg", label: "JPEG photo" } },
  {
    test: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
    type: { contentType: "image/png", ext: "png", label: "PNG image" },
  },
  { test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP", type: { contentType: "image/webp", ext: "webp", label: "WebP image" } },
  {
    test: (b) => ascii(b, 4, 4) === "ftyp" && ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(ascii(b, 8, 4)),
    type: { contentType: "image/heic", ext: "heic", label: "iPhone photo (HEIC)" },
  },
];

function ascii(b: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...b.subarray(start, start + len));
}

export function sniffFileType(bytes: Uint8Array): SniffedType | null {
  if (bytes.length < 12) return null;
  return ACCEPTED.find((a) => a.test(bytes))?.type ?? null;
}

export const ACCEPTED_UPLOAD_LABEL = "PDF, JPEG, PNG, WebP or iPhone (HEIC) photos";
export const MAX_UPLOAD_MB = 15;

/** Safe display name: no paths or control characters, at most 120 characters, keeps the extension we detected. */
export function safeFileName(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "document")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^\p{L}\p{N} ._()-]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${base || "document"}.${ext}`;
}
