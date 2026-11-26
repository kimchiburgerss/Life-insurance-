/**
 * Heir portal access (spec 5.10). Each heir gets a unique link printed in our
 * letters: <PUBLIC_APP_URL>/p/<token>. Only an HMAC of the token is used for
 * lookup (the encrypted copy lets letters be re-rendered). Opening the link
 * starts a 30-day portal session (httpOnly cookie) and the token leaves the
 * address bar. Operators can revoke and re-issue links.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import { decryptPii, encryptPii } from "@/lib/crypto/pii";
import { prisma, type DbClient } from "@/lib/db";
import { hmacHex } from "@/lib/files/crypto";
import { getAgreementSettings } from "@/lib/agreements/settings";
import { publicAppUrl } from "@/lib/outreach/settings";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const PORTAL_COOKIE = "hf_portal";
export const PORTAL_SESSION_DAYS = 30;

/** 20 readable characters ≈ 99 bits. */
export function newPortalToken(): string {
  const bytes = randomBytes(20);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function isPortalToken(v: string): boolean {
  return /^[a-hj-km-np-z2-9]{20}$/.test(v);
}

export function portalUrl(token: string): string {
  return `${publicAppUrl()}/p/${token}`;
}

/** The person's active portal link (created if missing). */
export async function ensurePortalAccess(db: DbClient, input: { caseId: string; personId: string; createdById?: string | null }): Promise<{ id: string; token: string; url: string; expiresAt: Date }> {
  const now = new Date();
  const existing = await db.portalAccess.findFirst({
    where: { personId: input.personId, caseId: input.caseId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    const token = decryptPii(existing.tokenEnc);
    return { id: existing.id, token, url: portalUrl(token), expiresAt: existing.expiresAt };
  }
  const settings = await getAgreementSettings(db);
  const token = newPortalToken();
  const created = await db.portalAccess.create({
    data: {
      caseId: input.caseId,
      personId: input.personId,
      tokenHash: hmacHex("portal-token", token),
      tokenEnc: encryptPii(token),
      expiresAt: new Date(now.getTime() + settings.portalLinkDays * 86_400_000),
      createdById: input.createdById ?? null,
    },
  });
  await writeAudit(db, {
    actor: input.createdById ? { type: "USER", id: input.createdById } : { type: "SYSTEM", id: "portal" },
    action: "portal.link_created",
    entityType: "Person",
    entityId: input.personId,
    after: { caseId: input.caseId, portalAccessId: created.id, expiresAt: created.expiresAt },
  });
  return { id: created.id, token, url: portalUrl(token), expiresAt: created.expiresAt };
}

export async function revokePortalAccess(actor: { id: string; role: string }, accessId: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    const a = await tx.portalAccess.update({ where: { id: accessId }, data: { revokedAt: new Date() } });
    await tx.portalSession.deleteMany({ where: { portalAccessId: accessId } });
    await writeAudit(tx, { actor: { type: "USER", id: actor.id, role: actor.role }, action: "portal.link_revoked", entityType: "Person", entityId: a.personId, after: { portalAccessId: accessId }, reason });
  });
}

/** Exchange a link token for a session. Returns the raw session secret for the cookie, or null. */
export async function startPortalSession(token: string, ipAddress?: string): Promise<{ secret: string; expiresAt: Date } | null> {
  if (!isPortalToken(token)) return null;
  const access = await prisma.portalAccess.findUnique({ where: { tokenHash: hmacHex("portal-token", token) }, include: { person: { select: { piiPurgedAt: true } } } });
  const now = new Date();
  if (!access || access.revokedAt || access.expiresAt <= now || access.person.piiPurgedAt) return null;
  const secret = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Math.min(now.getTime() + PORTAL_SESSION_DAYS * 86_400_000, access.expiresAt.getTime()));
  await prisma.portalSession.create({ data: { sessionHash: hmacHex("portal-session", secret), portalAccessId: access.id, expiresAt } });
  await prisma.portalAccess.update({ where: { id: access.id }, data: { lastUsedAt: now } });
  await writeAudit(prisma, { actor: { type: "HEIR", id: access.personId }, action: "portal.opened", entityType: "Person", entityId: access.personId, after: { caseId: access.caseId }, ipAddress });
  return { secret, expiresAt };
}

export type PortalContext = { sessionId: string; accessId: string; personId: string; caseId: string };

/** Resolve a session cookie value (null when missing, expired or revoked). */
export async function portalContextFromSecret(secret: string | undefined | null): Promise<PortalContext | null> {
  if (!secret || secret.length < 20 || secret.length > 100) return null;
  const s = await prisma.portalSession.findUnique({ where: { sessionHash: hmacHex("portal-session", secret) }, include: { portalAccess: true } });
  const now = new Date();
  if (!s || s.expiresAt <= now || s.portalAccess.revokedAt || s.portalAccess.expiresAt <= now) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > 5 * 60_000) await prisma.portalSession.update({ where: { id: s.id }, data: { lastSeenAt: now } });
  return { sessionId: s.id, accessId: s.portalAccessId, personId: s.portalAccess.personId, caseId: s.portalAccess.caseId };
}

export async function endPortalSession(secret: string) {
  await prisma.portalSession.deleteMany({ where: { sessionHash: hmacHex("portal-session", secret) } });
}
