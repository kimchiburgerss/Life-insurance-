import { requireOperator } from "@/lib/auth/session";
import { AgreementError, recordPaperSignature } from "@/lib/agreements/service";
import { parseDateOnly } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** OWNER uploads the scan/photo of a paper-signed agreement (≤ 10 MB) with the signing date. */
export async function POST(request: Request, ctx: RouteContext<"/api/agreements/[id]/paper-signature">) {
  const op = await requireOperator("approval:decide");
  const { id } = await ctx.params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const signedOn = String(form?.get("signedOn") ?? "");
  if (!(file instanceof File) || !/^\d{4}-\d{2}-\d{2}$/.test(signedOn)) return Response.json({ error: "Choose the signed file and the date it was signed." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "The file is larger than 10 MB." }, { status: 413 });
  try {
    await recordPaperSignature({ id: op.id, role: op.role }, id, { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, signedOn: parseDateOnly(signedOn) });
  } catch (e) {
    if (e instanceof AgreementError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return Response.json({ ok: true });
}
