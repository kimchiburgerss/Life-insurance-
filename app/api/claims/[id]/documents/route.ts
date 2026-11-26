import { requireOperator } from "@/lib/auth/session";
import { ClaimError, uploadForClaimant } from "@/lib/claims/service";

export const dynamic = "force-dynamic";

/** Operator uploads a document received by mail or in person, for this packet's claimant. */
export async function POST(request: Request, ctx: RouteContext<"/api/claims/[id]/documents">) {
  const op = await requireOperator("case:write");
  const { id } = await ctx.params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a file." }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return Response.json({ error: "The file is larger than 15 MB." }, { status: 413 });
  try {
    await uploadForClaimant({ id: op.id, role: op.role }, id, { checklistKey: String(form?.get("checklistKey") ?? ""), fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  } catch (e) {
    if (e instanceof ClaimError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return Response.json({ ok: true });
}
