import { PortalError, uploadDocument } from "@/lib/portal/service";
import { allowRequest } from "@/lib/portal/rate-limit";
import { MAX_UPLOAD_MB } from "@/lib/files/sniff";
import { currentPortal } from "@/lib/portal/session";

export const dynamic = "force-dynamic";

/** Heir document upload (multipart). Excluded from the proxy so large photos aren't truncated. */
export async function POST(request: Request) {
  const ctx = await currentPortal();
  if (!ctx) return Response.json({ error: "Your session has ended. Open the link in our letter again." }, { status: 401 });
  if (!(await allowRequest(`portal-upload:${ctx.personId}`, 30, 3600))) {
    return Response.json({ error: "That's a lot of uploads in a short time. Please wait a while and try again." }, { status: 429 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > (MAX_UPLOAD_MB + 1) * 1024 * 1024) return Response.json({ error: `The file is larger than ${MAX_UPLOAD_MB} MB.` }, { status: 413 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "The upload did not arrive. Please try again." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  try {
    await uploadDocument(ctx, { checklistKey: String(form.get("checklistKey") ?? ""), fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  } catch (e) {
    if (e instanceof PortalError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return Response.json({ ok: true });
}
