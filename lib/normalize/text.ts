/** Uppercase, strip accents, turn punctuation into spaces, collapse whitespace. */
export function cleanText(value: unknown, keep = ""): string {
  if (value === null || value === undefined) return "";
  const s = String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  const allowed = new RegExp(`[^A-Z0-9 ${keep.replace(/[\\\]^-]/g, "\\$&")}]`, "g");
  return s.replace(/['’]/g, "").replace(allowed, " ").replace(/\s+/g, " ").trim();
}

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}
