import { randomBytes } from "node:crypto";

export function normalizeWhitespaceUpper(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

const TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i — readable when printed

/** 16 characters ≈ 79 bits: unguessable, short enough to type from a printed letter. */
export function newOptOutToken(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return out;
}

export function isOptOutToken(value: string): boolean {
  return /^[a-hj-km-np-z2-9]{16}$/.test(value);
}
