/**
 * Encryption keys with versions, so PII_ENCRYPTION_KEY can be rotated
 * (`npm run keys:rotate`, OPERATIONS.md → Key rotation).
 *
 * - PII_ENCRYPTION_KEY: the current key; new data is encrypted with it.
 * - PII_KEY_VERSION: its version, 1–9 (default 1). Every ciphertext starts
 *   with "v<version>", so the right key is picked when reading.
 * - PII_PREVIOUS_KEYS: older keys, still needed to read data not yet
 *   re-encrypted: "1=<base64>,2=<base64>". Remove each once rotation is done.
 */
function decode(name: string, raw: string): Buffer {
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded`);
  return buf;
}

export function currentKeyVersion(): number {
  const v = Number(process.env.PII_KEY_VERSION ?? "1");
  if (!Number.isInteger(v) || v < 1 || v > 9) throw new Error("PII_KEY_VERSION must be a whole number from 1 to 9");
  return v;
}

/** The encryption key for a version (default: the current one). */
export function encryptionKey(version = currentKeyVersion()): Buffer {
  if (version === currentKeyVersion()) {
    const raw = process.env.PII_ENCRYPTION_KEY;
    if (!raw) throw new Error("PII_ENCRYPTION_KEY is not set");
    return decode("PII_ENCRYPTION_KEY", raw);
  }
  for (const entry of (process.env.PII_PREVIOUS_KEYS ?? "").split(",")) {
    const at = entry.indexOf("="); // the first "=" separates the version; base64 padding may contain more
    if (at < 0) continue;
    const v = Number(entry.slice(0, at).trim());
    const raw = entry.slice(at + 1).trim();
    if (v === version && raw) return decode(`PII_PREVIOUS_KEYS (version ${v})`, raw);
  }
  throw new Error(`No key for encryption version ${version}: add it to PII_PREVIOUS_KEYS as "${version}=<base64>"`);
}

/** "v3" → 3 (null if not a version tag). */
export function parseVersion(tag: string): number | null {
  const m = /^v([1-9])$/.exec(tag);
  return m ? Number(m[1]) : null;
}
