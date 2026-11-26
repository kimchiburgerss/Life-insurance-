import { optOutByToken } from "@/lib/outreach/service";
import { isOptOutToken } from "@/lib/outreach/util";

export const dynamic = "force-dynamic";

/**
 * RFC 8058 one-click unsubscribe (List-Unsubscribe-Post). Mail providers POST
 * "List-Unsubscribe=One-Click" here; the token is the credential. GET (a human
 * clicking the header link) goes to the confirmation page instead, because
 * link scanners prefetch GET URLs.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  if (isOptOutToken(token)) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    await optOutByToken(token, ip);
  }
  // Same answer whether or not the token exists: reveal nothing.
  return new Response("You have been unsubscribed. We will not contact you again.", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(request: Request, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  return Response.redirect(new URL(`/u/${encodeURIComponent(token)}`, request.url), 303);
}
