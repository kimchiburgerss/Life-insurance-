import "server-only";
import { createHmac } from "node:crypto";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { prisma } from "@/lib/db";

/**
 * One-time use for TOTP codes (ASVS 2.8.4). Better Auth accepts the previous,
 * current and next 30-second code but doesn't remember which were used, so a
 * code seen over someone's shoulder or through a phishing proxy could be
 * replayed for ~90 s. Before verification we *claim* (user, code) in a table
 * whose primary key makes the claim atomic; a second claim inside 5 minutes is
 * refused. If verification then fails, the claim is released.
 */
const PATH = "/two-factor/verify-totp";
const KEEP_MS = 5 * 60 * 1000;
const TWO_FACTOR_COOKIE = "two_factor"; // better-auth/plugins/two-factor constant

type HookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

function codeHash(userId: string, code: string): string {
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "dev-secret").update(`${userId}:${code}`).digest("hex");
}

/** The user being verified: the signed-in user (enrolment) or the one in the pending sign-in cookie. */
async function userIdFor(ctx: HookCtx): Promise<string | null> {
  const session = await getSessionFromCtx(ctx).catch(() => null);
  if (session?.user?.id) return session.user.id;
  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
  const signed = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!signed) return null;
  const v = await ctx.context.internalAdapter.findVerificationValue(signed);
  return v && new Date(v.expiresAt).getTime() > Date.now() ? v.value : null;
}

function codeOf(ctx: HookCtx): string {
  const code = (ctx.body as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code.trim() : "";
}

/** True if this (user, code) was not used in the last 5 minutes; records it. */
export async function claimTotpCode(userId: string, code: string): Promise<boolean> {
  await prisma.usedTotpCode.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } });
  const r = await prisma.$executeRaw`INSERT INTO "used_totp_codes" ("userId", "codeHash") VALUES (${userId}, ${codeHash(userId, code)}) ON CONFLICT DO NOTHING`;
  return r === 1;
}

export async function releaseTotpCode(userId: string, code: string): Promise<void> {
  await prisma.usedTotpCode.deleteMany({ where: { userId, codeHash: codeHash(userId, code) } });
}

export const totpReplayBefore = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== PATH) return;
  const code = codeOf(ctx);
  if (!code) return;
  const userId = await userIdFor(ctx);
  if (!userId) return; // the endpoint itself refuses an unknown sign-in
  if (!(await claimTotpCode(userId, code))) {
    throw APIError.from("UNAUTHORIZED", { message: "This code was already used. Wait for the next code in your authenticator app.", code: "TOTP_CODE_REUSED" });
  }
});

export const totpReplayAfter = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== PATH || !isAPIError(ctx.context.returned)) return;
  const code = codeOf(ctx);
  const userId = code ? await userIdFor(ctx) : null;
  if (userId) await releaseTotpCode(userId, code);
});
