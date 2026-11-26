/**
 * Create operator accounts outside the HTTP API (public sign-up is disabled).
 * Used by the seed script and `npm run user:create`.
 */
import { randomUUID } from "node:crypto";
import { hashPassword, symmetricEncrypt } from "better-auth/crypto";
import { writeAudit } from "@/lib/audit";
import type { DbClient } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/enums";

export type ProvisionInput = {
  email: string;
  name: string;
  password: string;
  role: Role;
  /**
   * Optional base32 TOTP secret to pre-enroll (demo/test accounts only).
   * Real operators should enroll themselves at /setup-2fa so the secret is
   * only ever shown on their own screen.
   */
  totpSecretBase32?: string;
  createdBy?: string;
};

export async function provisionOperator(db: DbClient, input: ProvisionInput) {
  if (input.password.length < 12) throw new Error("Password must be at least 12 characters.");
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");

  const email = input.email.trim().toLowerCase();
  const userId = randomUUID();
  const passwordHash = await hashPassword(input.password);

  const user = await db.user.create({
    data: {
      id: userId,
      email,
      name: input.name,
      emailVerified: true,
      role: input.role,
      twoFactorEnabled: Boolean(input.totpSecretBase32),
      accounts: {
        create: {
          id: randomUUID(),
          accountId: userId,
          providerId: "credential",
          password: passwordHash,
        },
      },
    },
  });

  if (input.totpSecretBase32) {
    await db.twoFactor.create({
      data: {
        id: randomUUID(),
        userId,
        // Better Auth accepts imported secrets with a "base32:" prefix.
        secret: await symmetricEncrypt({ key: secret, data: `base32:${input.totpSecretBase32}` }),
        backupCodes: await symmetricEncrypt({ key: secret, data: JSON.stringify([]) }),
        verified: true,
      },
    });
  }

  await writeAudit(db, {
    actor: { type: "SYSTEM", id: input.createdBy ?? "provision" },
    action: "user.created",
    entityType: "User",
    entityId: userId,
    after: { email, role: input.role, totpPreEnrolled: Boolean(input.totpSecretBase32) },
  });

  return user;
}
