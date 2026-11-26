import { headers } from "next/headers";
import { can } from "@/lib/auth/permissions";
import { auth } from "@/lib/auth/server";
import { DuplicateFileError, createImportBatch } from "@/lib/import/upload";
import { ImportFileError, MAX_UPLOAD_BYTES } from "@/lib/import/parse";
import type { Role } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

/**
 * Upload endpoint. Excluded from the proxy matcher (proxy.ts) because the
 * proxy only buffers the first 10 MB of a request body; this handler does its
 * own full auth check and enforces IMPORT_MAX_MB.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !session.user.twoFactorEnabled) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!can((session.user.role ?? "VIEWER") as Role, "import:run")) {
    return Response.json({ error: "Your role can't import files." }, { status: 403 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return Response.json({ error: `File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` }, { status: 413 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  try {
    const batch = await createImportBatch({
      fileName: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
      source: String(form.get("source") ?? ""),
      createdById: session.user.id,
      allowDuplicateFile: form.get("allowDuplicate") === "true",
    });
    return Response.json({ id: batch.id });
  } catch (e) {
    if (e instanceof DuplicateFileError) {
      return Response.json({ error: e.message, existingBatchId: e.existingBatchId }, { status: 409 });
    }
    if (e instanceof ImportFileError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
