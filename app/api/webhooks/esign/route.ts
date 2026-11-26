import { applyESignEvent } from "@/lib/agreements/gateway";
import { DROPBOX_SIGN_ACK, parseDropboxSignEvent, verifyDropboxSignEvent } from "@/adapters/esign/webhook";

export const dynamic = "force-dynamic";

/**
 * Dropbox Sign callback URL (set it in the Dropbox Sign API settings). The
 * event arrives as multipart form data with a "json" field; its event_hash is
 * checked against our API key before anything is applied.
 */
export async function POST(request: Request) {
  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  if (!apiKey) return new Response("e-sign webhook not configured", { status: 503 });
  let payload: unknown;
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      payload = JSON.parse(String(form.get("json") ?? ""));
    } else {
      payload = await request.json();
    }
  } catch {
    return new Response("invalid payload", { status: 400 });
  }
  const p = payload as Parameters<typeof verifyDropboxSignEvent>[0];
  if (!verifyDropboxSignEvent(p, apiKey)) return new Response("invalid event hash", { status: 401 });
  const event = parseDropboxSignEvent(p);
  if (event && event.type !== "OTHER") await applyESignEvent(event);
  return new Response(DROPBOX_SIGN_ACK, { status: 200, headers: { "Content-Type": "text/plain" } });
}
