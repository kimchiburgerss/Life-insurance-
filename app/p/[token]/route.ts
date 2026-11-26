import { NextResponse } from "next/server";
import { PORTAL_COOKIE, startPortalSession } from "@/lib/portal/access";
import { allowRequest } from "@/lib/portal/rate-limit";
import { ipFromRequest } from "@/lib/portal/session";

export const dynamic = "force-dynamic";

/**
 * The link printed in our letters. Exchanges the token for a portal session
 * cookie and redirects to /portal, so the token leaves the address bar and
 * browser history. Rate-limited per IP to stop token guessing.
 */
export async function GET(request: Request, ctx: RouteContext<"/p/[token]">) {
  const { token } = await ctx.params;
  const ip = ipFromRequest(request);
  const ok = await allowRequest(`portal-link:${ip}`, 30, 600);
  const session = ok ? await startPortalSession(token, ip) : null;
  const res = NextResponse.redirect(new URL(session ? "/portal" : "/portal?link=invalid", request.url), 303);
  res.headers.set("Referrer-Policy", "no-referrer");
  if (session) {
    res.cookies.set(PORTAL_COOKIE, session.secret, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: session.expiresAt,
    });
  }
  return res;
}
