import { heirPacketFile } from "@/lib/portal/service";
import { currentPortal } from "@/lib/portal/session";

export const dynamic = "force-dynamic";

/** The heir's own approved claim packet. */
export async function GET(_request: Request, ctx: RouteContext<"/api/portal/packets/[id]">) {
  const portal = await currentPortal();
  if (!portal) return new Response("Your session has ended. Open the link in our letter again.", { status: 401 });
  const { id } = await ctx.params;
  const file = await heirPacketFile(portal, id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file.meta.fileName.replace(/["\\\r\n]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
