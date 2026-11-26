"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requestIp, requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const Input = z.object({
  ruleId: z.string().min(1),
  verified: z.enum(["true", "false"]).transform((v) => v === "true"),
  note: z.string().trim().max(500).optional(),
});

export async function setRuleVerified(formData: FormData) {
  const operator = await requireOperator("rules:manage");
  const { ruleId, verified, note } = Input.parse(Object.fromEntries(formData));

  await prisma.$transaction(async (tx) => {
    const before = await tx.jurisdictionRule.findUniqueOrThrow({ where: { id: ruleId } });
    const after = await tx.jurisdictionRule.update({
      where: { id: ruleId },
      data: verified
        ? { lastVerifiedAt: new Date(), verifiedBy: operator.name }
        : { lastVerifiedAt: null, verifiedBy: null },
    });
    await writeAudit(tx, {
      actor: { type: "USER", id: operator.id, role: operator.role },
      action: verified ? "rule.verified" : "rule.unverified",
      entityType: "JurisdictionRule",
      entityId: ruleId,
      before: { lastVerifiedAt: before.lastVerifiedAt, verifiedBy: before.verifiedBy },
      after: { lastVerifiedAt: after.lastVerifiedAt, verifiedBy: after.verifiedBy },
      reason: note || undefined,
      ipAddress: await requestIp(),
    });
  });
  revalidatePath("/rules");
  revalidatePath("/");
}
