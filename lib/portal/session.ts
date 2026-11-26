import "server-only";
import { cookies, headers } from "next/headers";
import { PORTAL_COOKIE, portalContextFromSecret, type PortalContext } from "./access";

/** The heir's portal session from the cookie, or null. */
export async function currentPortal(): Promise<PortalContext | null> {
  const store = await cookies();
  return portalContextFromSecret(store.get(PORTAL_COOKIE)?.value);
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export function ipFromRequest(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
