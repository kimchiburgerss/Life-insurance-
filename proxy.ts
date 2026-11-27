import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, isPublicPage, newNonce } from "@/lib/security/csp";

/**
 * Runs on every page (not on /api routes, which each check their own session
 * or signature and must not have their upload bodies buffered here).
 *
 * 1. Content-Security-Policy with a fresh nonce per request. Next.js reads the
 *    nonce from the request header and puts it on its own scripts.
 * 2. Optimistic redirect to /login for operator pages without a session
 *    cookie. Real authorization happens in lib/auth/session.ts.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isPublicPage(pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const nonce = newNonce();
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === "development",
    https: (process.env.BETTER_AUTH_URL ?? "").startsWith("https://"),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Every page. Excluded: /api/* (route handlers authenticate themselves:
  // operator session, heir portal session, webhook signature or opt-out
  // token — enforced by tests/unit/api-routes-authenticate.test.ts — and
  // uploads must not hit the proxy's 10 MB body buffer) and static assets.
  // Public pages (login, heir portal, /p/<token>, /u/<token>) get the CSP but
  // no login redirect.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
