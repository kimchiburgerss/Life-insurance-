import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { prisma } from "@/lib/db";

export const APP_NAME = "Heir Finder";

/** Sign-in / 2FA attempts per IP per minute. Raise only for automated test runs. */
const AUTH_ATTEMPTS_PER_MINUTE = Number(process.env.AUTH_ATTEMPTS_PER_MINUTE ?? 5);

/**
 * Operator authentication: email + password + mandatory TOTP.
 * - Public sign-up is disabled; operators are created by the OWNER
 *   (or `npm run user:create`).
 * - 2FA is *enforced* by the data-access layer (lib/auth/session.ts): a
 *   session whose user has not enrolled TOTP can only reach /setup-2fa.
 * - Rate limiting is stored in Postgres so it survives restarts.
 * - CSRF: Better Auth rejects requests whose Origin is not trusted; server
 *   actions are origin-checked by Next.js.
 */
export const auth = betterAuth({
  appName: APP_NAME,
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  trustedOrigins: process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : [],
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 12, // 12 hours
    updateAge: 60 * 60, // refresh at most hourly
  },
  user: {
    additionalFields: {
      role: {
        type: ["OWNER", "RESEARCHER", "VIEWER"],
        required: false,
        defaultValue: "VIEWER",
        input: false, // never settable from a client request
      },
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: AUTH_ATTEMPTS_PER_MINUTE },
      "/two-factor/verify-totp": { window: 60, max: AUTH_ATTEMPTS_PER_MINUTE },
      "/two-factor/verify-backup-code": { window: 60, max: AUTH_ATTEMPTS_PER_MINUTE },
      "/two-factor/enable": { window: 60, max: AUTH_ATTEMPTS_PER_MINUTE },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [
    twoFactor({
      issuer: APP_NAME,
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
    }),
    nextCookies(), // must be last: lets server actions set auth cookies
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
