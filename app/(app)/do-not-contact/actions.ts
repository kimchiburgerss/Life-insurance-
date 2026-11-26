"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { addDoNotContact, removeDoNotContact } from "@/lib/outreach/dnc";

export type ActionState = { ok?: string; error?: string };

export async function addDncAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("case:write");
  try {
    await addDoNotContact(prisma, { type: "USER", id: op.id, role: op.role }, {
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      address: String(fd.get("address") ?? ""),
      reason: String(fd.get("reason") ?? ""),
      createdById: op.id,
    });
  } catch (e) {
    if (e instanceof Error && !(e.name === "PrismaClientKnownRequestError")) return { error: e.message };
    throw e;
  }
  revalidatePath("/do-not-contact");
  return { ok: "Added. Drafting, approving and sending to a match is now blocked on every case." };
}

export async function removeDncAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const op = await requireOperator("compliance:override");
  try {
    await removeDoNotContact(op, String(fd.get("id")), String(fd.get("reason") ?? ""));
  } catch (e) {
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/do-not-contact");
  return { ok: "Removed (logged with your reason)." };
}
