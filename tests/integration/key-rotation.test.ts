import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { encryptionKey } from "@/lib/crypto/keys";
import { decryptPii, encryptPii, piiKeyVersion } from "@/lib/crypto/pii";
import { rotateEncryption } from "@/lib/crypto/rotate";
import { prisma } from "@/lib/db";
import { fileKeyVersion } from "@/lib/files/crypto";
import { readFile, saveFile } from "@/lib/files/storage";
import { makeCase, makeUser } from "../helpers/factories";

const saved = { key: process.env.PII_ENCRYPTION_KEY, version: process.env.PII_KEY_VERSION, previous: process.env.PII_PREVIOUS_KEYS };
afterAll(async () => {
  process.env.PII_ENCRYPTION_KEY = saved.key;
  if (saved.version === undefined) delete process.env.PII_KEY_VERSION;
  else process.env.PII_KEY_VERSION = saved.version;
  if (saved.previous === undefined) delete process.env.PII_PREVIOUS_KEYS;
  else process.env.PII_PREVIOUS_KEYS = saved.previous;
  await prisma.$disconnect();
});

describe("encryption key rotation", () => {
  it("parses previous keys whose base64 ends in '=' padding, and names a missing one", () => {
    const k = randomBytes(32).toString("base64");
    expect(k.endsWith("=")).toBe(true);
    process.env.PII_KEY_VERSION = "3";
    process.env.PII_PREVIOUS_KEYS = ` 1=${randomBytes(32).toString("base64")} , 2=${k}`;
    expect(encryptionKey(2).toString("base64")).toBe(k);
    expect(() => encryptionKey(5)).toThrow(/PII_PREVIOUS_KEYS/);
    process.env.PII_KEY_VERSION = saved.version ?? "1";
    delete process.env.PII_PREVIOUS_KEYS;
  });

  it("re-encrypts contact details, approved-message recipients and documents under the new key; old data stays readable meanwhile", async () => {
    const k1 = process.env.PII_ENCRYPTION_KEY!;
    process.env.PII_KEY_VERSION = "1";
    delete process.env.PII_PREVIOUS_KEYS;
    const { user } = await makeUser("OWNER", { totp: false });
    const c = await makeCase([new Date("2020-01-15T00:00:00Z")]);
    const person = await prisma.person.create({
      data: { caseId: c.id, fullName: "Kai Rotate", normalizedName: "KAI ROTATE", relationship: "CHILD", emailEnc: encryptPii("kai@example.com"), mailingAddressEnc: encryptPii("9 Pine Rd, Elko, NV 89801") },
    });
    const comm = await prisma.communication.create({ data: { caseId: c.id, personId: person.id, channel: "MAIL", direction: "OUTBOUND", status: "DRAFT", recipientEnc: encryptPii('{"name":"Kai"}') } });
    const approval = await prisma.approval.create({ data: { subjectType: "COMMUNICATION", subjectId: comm.id, decision: "APPROVED", contentHash: "h", contentSnapshot: "(test)", approvedById: user.id } });
    await prisma.communication.update({ where: { id: comm.id }, data: { approvalId: approval.id, contentHash: "h" } });
    const file = await saveFile(prisma, { caseId: c.id, kind: "HEIR_UPLOAD", fileName: "a.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF fictional"), uploadedBy: user.id });

    // Rotate: new key is version 2; the old one is kept for reading.
    const k2 = randomBytes(32).toString("base64");
    process.env.PII_ENCRYPTION_KEY = k2;
    process.env.PII_KEY_VERSION = "2";
    process.env.PII_PREVIOUS_KEYS = `1=${k1}`;
    const p0 = await prisma.person.findUniqueOrThrow({ where: { id: person.id } });
    expect(decryptPii(p0.emailEnc!)).toBe("kai@example.com");
    expect(piiKeyVersion(encryptPii("x"))).toBe(2);

    // Outside the rotation script, an approved message's recipient still can't change.
    await expect(prisma.communication.update({ where: { id: comm.id }, data: { recipientEnc: encryptPii('{"name":"Someone else"}') } })).rejects.toThrow(/can no longer be edited/);

    const scope = { caseIds: [c.id] };
    expect(await rotateEncryption({ dryRun: true, scope })).toMatchObject({ version: 2, files: 1, fields: { "persons.emailEnc": 1, "persons.mailingAddressEnc": 1, "communications.recipientEnc": 1 } });
    const r = await rotateEncryption({ scope });
    expect(r.files).toBe(1);
    expect(r.fields["communications.recipientEnc"]).toBe(1);
    expect(await rotateEncryption({ dryRun: true, scope })).toMatchObject({ files: 0, fields: { "persons.emailEnc": 0, "communications.recipientEnc": 0 } });

    // The old key can now be removed: everything reads with the new key alone.
    delete process.env.PII_PREVIOUS_KEYS;
    const p1 = await prisma.person.findUniqueOrThrow({ where: { id: person.id } });
    expect(decryptPii(p1.emailEnc!)).toBe("kai@example.com");
    expect(decryptPii(p1.mailingAddressEnc!)).toBe("9 Pine Rd, Elko, NV 89801");
    const c1 = await prisma.communication.findUniqueOrThrow({ where: { id: comm.id } });
    expect(JSON.parse(decryptPii(c1.recipientEnc!))).toEqual({ name: "Kai" });
    expect(c1.contentHash).toBe("h");
    const f1 = await prisma.storedFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(fileKeyVersion(f1.data)).toBe(2);
    expect(new TextDecoder().decode((await readFile(file.id))!.bytes)).toBe("%PDF fictional");
  });
});
