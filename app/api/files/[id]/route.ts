import { requireOperator } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { readFile, verifyFileSignature } from "@/lib/files/storage";

export const dynamic = "force-dynamic";

/**
 * Operator download of an encrypted document. Needs BOTH a signed, unexpired
 * URL (minted by a page the operator could see) and a 2FA operator session.
 * Heir uploads are always served as attachments; generated agreements and
 * images can be shown inline. Every download is audited.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/files/[id]">) {
  const operator = await requireOperator("case:read");
  const { id } = await ctx.params;
  const url = new URL(request.url);
  if (!verifyFileSignature(id, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return new Response("This link has expired. Reload the page and try again.", { status: 403 });
  }
  const file = await readFile(id);
  if (!file) return new Response("Not found", { status: 404 });
  const generated = file.meta.kind === "AGREEMENT_PDF" || file.meta.kind === "AGREEMENT_SIGNED";
  const inline = url.searchParams.get("download") !== "1" && (generated || file.meta.contentType.startsWith("image/"));
  await writeAudit(prisma, {
    actor: { type: "USER", id: operator.id, role: operator.role },
    action: "file.downloaded",
    entityType: "StoredFile",
    entityId: id,
    after: { kind: file.meta.kind, caseId: file.meta.caseId, inline },
  });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.meta.contentType,
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.meta.fileName.replace(/["\\\r\n]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(generated ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:" }),
    },
  });
}
