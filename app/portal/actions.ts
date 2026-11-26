"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AgreementSendRefused, simulateMockSignature } from "@/lib/agreements/gateway";
import { ForbiddenError } from "@/lib/auth/permissions";
import { endPortalSession, PORTAL_COOKIE } from "@/lib/portal/access";
import { enforceLimit, RateLimitedError } from "@/lib/portal/rate-limit";
import { optOutFromPortal, PortalError, provideEmail, requestCall, sendPortalMessage } from "@/lib/portal/service";
import { clientIp, currentPortal } from "@/lib/portal/session";

export type PortalActionState = { ok?: string; error?: string };

async function run(fn: (ctx: NonNullable<Awaited<ReturnType<typeof currentPortal>>>) => Promise<string>): Promise<PortalActionState> {
  const ctx = await currentPortal();
  if (!ctx) return { error: "Your session has ended. Please open the link in our letter again." };
  try {
    await enforceLimit(`portal-action:${ctx.personId}`, 40, 3600);
    const ok = await fn(ctx);
    revalidatePath("/portal");
    return { ok };
  } catch (e) {
    if (e instanceof PortalError || e instanceof RateLimitedError || e instanceof AgreementSendRefused || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}

export async function messageAction(_: PortalActionState, fd: FormData) {
  return run(async (ctx) => {
    await sendPortalMessage(ctx, String(fd.get("message") ?? ""));
    return "Thank you. Your message was sent. A real person will read it and reply.";
  });
}

export async function callAction(_: PortalActionState, fd: FormData) {
  return run(async (ctx) => {
    await requestCall(ctx, { phone: String(fd.get("phone") ?? ""), times: String(fd.get("times") ?? "") });
    return "Thank you. We will call you. No automated calls — a real person will phone.";
  });
}

export async function emailAction(_: PortalActionState, fd: FormData) {
  return run(async (ctx) => {
    await provideEmail(ctx, String(fd.get("email") ?? ""));
    return "Thank you. We saved your email address.";
  });
}

export async function demoSignAction(_: PortalActionState, fd: FormData) {
  return run(async (ctx) => {
    if (fd.get("agree") !== "on") throw new PortalError("Tick the box to confirm you read the agreement and want to sign it electronically.");
    const typed = String(fd.get("typedName") ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const expected = String(fd.get("expectedName") ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!typed || typed !== expected) throw new PortalError("Type your full name exactly as it appears on the agreement.");
    await simulateMockSignature(String(fd.get("agreementId") ?? ""), ctx.personId);
    return "Signed. Thank you — you can download your copy below.";
  });
}

export async function stopContactAction(_: PortalActionState, fd: FormData) {
  return run(async (ctx) => {
    if (fd.get("confirm") !== "on") throw new PortalError("Tick the box to confirm.");
    await optOutFromPortal(ctx, await clientIp());
    return "Done. We will not contact you again.";
  });
}

export async function signOutAction() {
  const store = await cookies();
  const secret = store.get(PORTAL_COOKIE)?.value;
  if (secret) await endPortalSession(secret);
  store.delete(PORTAL_COOKIE);
  redirect("/portal?signedOut=1");
}
