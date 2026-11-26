/** Jaro-Winkler similarity in [0, 1] — the standard choice for short person names. */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * prefixScale * (1 - jaro);
}

/** American Soundex (R163 for ROBERT/RUPERT). Used only to pick match candidates. */
export function soundex(word: string): string {
  const s = word.toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "";
  const codes: Record<string, string> = {
    B: "1", F: "1", P: "1", V: "1",
    C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2",
    D: "3", T: "3", L: "4", M: "5", N: "5", R: "6",
  };
  let out = s[0]!;
  let prev = codes[s[0]!] ?? "";
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const ch = s[i]!;
    const code = codes[ch] ?? "";
    if (code && code !== prev) out += code;
    // H and W don't separate equal codes; vowels do.
    if (ch !== "H" && ch !== "W") prev = code;
  }
  return out.padEnd(4, "0");
}
