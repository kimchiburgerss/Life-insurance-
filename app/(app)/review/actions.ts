"use server";

import { revalidatePath } from "next/cache";
import { requestIp, requireOperator } from "@/lib/auth/session";
import { decideOwnerMatch, ReviewError } from "@/lib/import/review";

export type ReviewState = { error?: string; done?: string };

export async function decideMatch(_: ReviewState, formData: FormData): Promise<ReviewState> {
  const operator = await requireOperator("owners:merge");
  const decision = formData.get("decision") === "MERGE" ? "MERGE" : "SEPARATE";
  try {
    await decideOwnerMatch({
      candidateId: String(formData.get("candidateId")),
      decision,
      actor: { id: operator.id, role: operator.role },
      ipAddress: await requestIp(),
    });
  } catch (e) {
    if (e instanceof ReviewError) return { error: e.message };
    throw e;
  }
  revalidatePath("/review");
  revalidatePath("/pipeline");
  return { done: decision === "MERGE" ? "Merged." : "Kept as separate people." };
}
