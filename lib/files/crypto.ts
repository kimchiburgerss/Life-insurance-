/**
 * Encryption for stored documents (heir uploads, agreements): AES-256-GCM with
 * a random 96-bit IV per file. The file key is derived from PII_ENCRYPTION_KEY
 * with HKDF (separate purpose label), so it is never the same key that
 * encrypts contact-detail fields. Format: "v<key version>" (2 bytes) | IV (12) | tag (16) | ciphertext.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { currentKeyVersion, encryptionKey, parseVersion } from "@/lib/crypto/keys";

function baseKey(name: "PII_HMAC_KEY"): Buffer {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set`);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded`);
  return buf;
}

function hkdf(base: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", base, Buffer.alloc(0), Buffer.from(`heir-finder:${purpose}:v1`), 32));
}

function derived(name: "PII_HMAC_KEY", purpose: string): Buffer {
  return hkdf(baseKey(name), purpose);
}

export function encryptBytes(plain: Uint8Array): Buffer {
  const version = currentKeyVersion();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", hkdf(encryptionKey(version), "files"), iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from(`v${version}`), iv, cipher.getAuthTag(), ct]);
}

/** Key version a stored file was encrypted with (null if unrecognized). */
export function fileKeyVersion(payload: Uint8Array): number | null {
  return parseVersion(Buffer.from(payload.subarray(0, 2)).toString());
}

export function decryptBytes(payload: Uint8Array): Buffer {
  const buf = Buffer.from(payload);
  const version = fileKeyVersion(buf);
  if (!version || buf.length < 30) throw new Error("Unrecognized encrypted file format");
  const decipher = createDecipheriv("aes-256-gcm", hkdf(encryptionKey(version), "files"), buf.subarray(2, 14));
  decipher.setAuthTag(buf.subarray(14, 30));
  return Buffer.concat([decipher.update(buf.subarray(30)), decipher.final()]);
}

/** HMAC for signed URLs and portal tokens (key derived from PII_HMAC_KEY). */
export function hmacHex(purpose: "file-url" | "portal-token" | "portal-session", value: string): string {
  return createHmac("sha256", derived("PII_HMAC_KEY", purpose)).update(value).digest("hex");
}
