import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { redactForAudit } from "@/lib/audit";
import { blindIndex, decryptPii, encryptPii, redactSsnLike } from "@/lib/crypto/pii";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_HMAC_KEY ??= randomBytes(32).toString("base64");
});

describe("PII encryption", () => {
  it("round-trips and never repeats ciphertext", () => {
    const a = encryptPii("jane@example.com");
    const b = encryptPii("jane@example.com");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toContain("jane");
    expect(decryptPii(a)).toBe("jane@example.com");
  });

  it("detects tampering", () => {
    const enc = encryptPii("123 Main St");
    const parts = enc.split(":");
    const data = Buffer.from(parts[3]!, "base64");
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString("base64");
    expect(() => decryptPii(parts.join(":"))).toThrow();
  });

  it("blind index is deterministic and normalizes case/whitespace", () => {
    expect(blindIndex(" Jane@Example.com ")).toBe(blindIndex("jane@example.com"));
    expect(blindIndex("a@example.com")).not.toBe(blindIndex("b@example.com"));
  });

  it("redacts SSN-like numbers", () => {
    expect(redactSsnLike("SSN 123-45-6789 and 123 45 6789 and 123456789")).toBe(
      "SSN [REDACTED-SSN] and [REDACTED-SSN] and [REDACTED-SSN]",
    );
    expect(redactSsnLike("Policy 000-12-3456")).toBe("Policy 000-12-3456"); // invalid SSN area
  });
});

describe("audit redaction", () => {
  it("strips encrypted fields, secrets and contact details recursively", () => {
    expect(
      redactForAudit({
        stage: "CONTACTED",
        emailEnc: "v1:abc",
        person: { fullName: "Jane Doe", phoneEnc: "v1:x", email: "j@example.com", mailingAddressEnc: null },
        password: "hunter2",
        when: new Date("2026-01-01T00:00:00Z"),
        id: 5n,
      }),
    ).toEqual({
      stage: "CONTACTED",
      emailEnc: "[REDACTED]",
      person: { fullName: "Jane Doe", phoneEnc: "[REDACTED]", email: "[REDACTED]", mailingAddressEnc: null },
      password: "[REDACTED]",
      when: "2026-01-01T00:00:00.000Z",
      id: "5",
    });
  });
});
