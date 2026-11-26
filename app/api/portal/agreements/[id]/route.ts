import { heirAgreementFile } from "@/lib/portal/service";
import { currentPortal } from "@/lib/portal/session";

export const dynamic = "force-dynamic";

/** The heir's own agreement (unsigned once sent, or the signed copy). */
export async function GET(request: Request, ctx: RouteContext<"/api/portal/agreements/[id]">) {
  const portal = await currentPortal();
  if (!portal) return new Response("Your session has ended. Open the link in our letter again.", { status: 401 });
  const { id } = await ctx.params;
  const kind = new URL(request.url).searchParams.get("kind") === "signed" ? "signed" : "unsigned";
  const file = await heirAgreementFile(portal, id, kind);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${file.meta.fileName.replace(/["\\\r\n]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
