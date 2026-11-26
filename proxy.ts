import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect only: sends visitors without a session cookie to the
 * login page. Real authorization happens in lib/auth/session.ts.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except auth endpoints, the login page, static assets and health check.
  // /api/imports is excluded so large uploads are not truncated at the proxy
  // body-buffer limit (10 MB); that route checks the session itself.
  matcher: ["/((?!api/auth|api/health|api/imports|login|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
