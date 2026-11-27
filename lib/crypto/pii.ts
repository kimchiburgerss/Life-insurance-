/**
 * Field-level encryption for PII (heir contact details, uploaded-document keys).
 *
 * - AES-256-GCM with a random 96-bit IV per value.
 * - Output format: "v<key version>:<iv b64>:<tag b64>:<ciphertext b64>". The
 *   version selects the key (lib/crypto/keys.ts), so keys can be rotated.
 * - Blind index: HMAC-SHA256 with a SEPARATE key, so equality lookups
 *   (do-not-contact, dedupe) work without storing plaintext.
 *
 * Never store SSNs at all (build spec section 4).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { currentKeyVersion, encryptionKey, parseVersion } from "./keys";

function hmacKey(): Buffer {
  const raw = process.env.PII_HMAC_KEY;
  if (!raw) throw new Error("PII_HMAC_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("PII_HMAC_KEY must be 32 bytes, base64-encoded");
  return buf;
}

export function encryptPii(plaintext: string): string {
  const version = currentKeyVersion();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(version), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [`v${version}`, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Key version a stored value was encrypted with (null if not encrypted by us). */
export function piiKeyVersion(payload: string): number | null {
  return parseVersion(payload.split(":", 1)[0] ?? "");
}

export function decryptPii(payload: string): string {
  const [tag0, ivB64, tagB64, dataB64] = payload.split(":");
  const version = parseVersion(tag0 ?? "");
  if (!version || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error("Unrecognized encrypted payload format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(version), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

export function encryptOptional(value: string | null | undefined): string | null {
  return value == null || value === "" ? null : encryptPii(value);
}

export function decryptOptional(value: string | null | undefined): string | null {
  return value == null ? null : decryptPii(value);
}

/** Deterministic keyed hash for lookups. Normalize before hashing. */
export function blindIndex(value: string): string {
  return createHmac("sha256", hmacKey()).update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Matches SSN-like patterns (123-45-6789, 123 45 6789, 123456789), including
 * ITINs (9XX-XX-XXXX), which are equally sensitive. Over-redaction of other
 * 9-digit numbers is accepted: this guards what is stored and sent to AI.
 */
export const SSN_PATTERN = /\b(?!000|666)\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g;

/** Replace SSN-like sequences before text is stored or sent to an AI model. */
export function redactSsnLike(text: string): string {
  return text.replace(SSN_PATTERN, "[REDACTED-SSN]");
}
