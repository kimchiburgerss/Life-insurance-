"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/session";
import { unlockDueCases } from "@/lib/case/waiting";

export async function runUnlockNow(): Promise<{ ok?: string }> {
  await requireOperator("case:transition:any");
  const r = await unlockDueCases();
  revalidatePath("/calendar");
  revalidatePath("/");
  return { ok: `${r.unlocked} unlocked, ${r.blocked} blocked (see notifications).` };
}
