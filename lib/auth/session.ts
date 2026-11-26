import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/lib/generated/prisma/enums";
import { can, ForbiddenError, type Permission } from "./permissions";
import { auth } from "./server";

/**
 * Data-access layer for authentication. Every page, server action and route
 * handler that touches case data calls `requireOperator()` — the proxy's
 * cookie check is only an optimistic redirect, not a security boundary.
 */

export type Operator = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** Signed in, enrolled in TOTP, and (optionally) holding `permission`. */
export async function requireOperator(permission?: Permission): Promise<Operator> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.twoFactorEnabled) redirect("/setup-2fa");
  const role = (session.user.role ?? "VIEWER") as Role;
  if (permission && !can(role, permission)) {
    throw new ForbiddenError(`This action requires the "${permission}" permission.`);
  }
  return { id: session.user.id, name: session.user.name, email: session.user.email, role };
}

/** For server actions: client IP for the audit log (best effort). */
export async function requestIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
}
