"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireOperator } from "@/lib/auth/session";
import { saveBusinessProfile, saveOutreachSettings } from "@/lib/outreach/settings";
import { currentTemplateVersions } from "@/lib/outreach/templates";

export type ActionState = { ok?: string; error?: string };

function zodMessage(e: ZodError): string {
  return e.issues.map((i) => i.message).join(" ");
}

export async function saveBusinessAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("rules:manage");
  const s = (k: string) => String(fd.get(k) ?? "");
  try {
    await saveBusinessProfile(op, {
      legalName: s("legalName"),
      contactName: s("contactName"),
      contactTitle: s("contactTitle"),
      mailingAddress: { line1: s("line1"), line2: s("line2"), city: s("city"), state: s("state"), zip: s("zip") },
      phone: s("phone"),
      email: s("email"),
      website: s("website"),
    });
  } catch (e) {
    if (e instanceof ZodError) return { error: zodMessage(e) };
    throw e;
  }
  revalidatePath("/settings");
  return { ok: "Business profile saved. New drafts use it; existing drafts keep the text they were made with." };
}

export async function saveOutreachAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("rules:manage");
  const pct = Number(String(fd.get("feePercent") ?? "").replace("%", ""));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: "Enter the fee as a percentage, e.g. 10." };
  try {
    await saveOutreachSettings(op, { feeBps: Math.round(pct * 100), sendingPaused: fd.get("sendingPaused") === "on" });
  } catch (e) {
    if (e instanceof ZodError) return { error: zodMessage(e) };
    throw e;
  }
  revalidatePath("/settings");
  return { ok: "Saved. Letters always quote the lower of this fee and the legal cap for the case." };
}

export async function recordCounselAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("rules:manage");
  const approvedBy = String(fd.get("approvedBy") ?? "").trim();
  const approvedOn = String(fd.get("approvedOn") ?? "");
  if (fd.get("confirm") !== "on") return { error: "Tick the box to confirm counsel reviewed these exact template versions." };
  if (approvedBy.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(approvedOn)) return { error: "Enter counsel's name and the approval date." };
  await saveOutreachSettings(
    op,
    { counselApproval: { approvedBy, approvedOn, templateVersions: currentTemplateVersions(), recordedById: op.id, recordedAt: new Date().toISOString() } },
    `Counsel approval recorded: ${approvedBy}, ${approvedOn}`,
  );
  revalidatePath("/settings");
  return { ok: "Recorded. Changing any template's version will require a new approval." };
}

export async function clearCounselAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("rules:manage");
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 10) return { error: "Give a reason (at least 10 characters)." };
  await saveOutreachSettings(op, { counselApproval: null }, reason);
  revalidatePath("/settings");
  return { ok: "Counsel approval cleared. Real sending is blocked until it is recorded again." };
}

export async function saveAgreementOptionsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("rules:manage");
  const { saveAgreementSettings } = await import("@/lib/agreements/settings");
  try {
    await saveAgreementSettings(op, {
      cancellationDays: Number(fd.get("cancellationDays") ?? 10),
      bookingUrl: String(fd.get("bookingUrl") ?? "").trim(),
      portalLinkDays: Number(fd.get("portalLinkDays") ?? 365),
    });
  } catch (e) {
    if (e instanceof ZodError) return { error: zodMessage(e) };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/settings");
  return { ok: "Saved. New agreements and portal links use these settings." };
}

export async function uploadAttorneyAgreementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("rules:manage");
  const { uploadAttorneyTemplate } = await import("@/lib/agreements/settings");
  const file = fd.get("file");
  let source = String(fd.get("text") ?? "");
  if (file instanceof File && file.size > 0) {
    if (file.size > 200_000) return { error: "The file is too large for an agreement template." };
    source = await file.text();
  }
  if (fd.get("confirm") !== "on") return { error: "Tick the box to confirm a licensed Nevada attorney approved this exact text." };
  try {
    await uploadAttorneyTemplate(op, { source, approvedBy: String(fd.get("approvedBy") ?? ""), approvedOn: String(fd.get("approvedOn") ?? "") });
  } catch (e) {
    if (e instanceof ZodError) return { error: zodMessage(e) };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/settings");
  return { ok: "Uploaded. Review it, then switch it on below." };
}

export async function toggleAttorneyAgreementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("rules:manage");
  const { saveAgreementSettings } = await import("@/lib/agreements/settings");
  const on = fd.get("use") === "on";
  try {
    await saveAgreementSettings(op, { useAttorneyTemplate: on }, on ? "Attorney-approved agreement switched on" : "Switched back to the DRAFT agreement");
  } catch (e) {
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/settings");
  return { ok: on ? "New agreements use the attorney-approved text (no DRAFT marking)." : "New agreements use the DRAFT text again." };
}
