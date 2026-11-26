import { randomUUID } from "node:crypto";
import { provisionOperator } from "@/lib/auth/provision";
import { generateTotpSecret } from "@/lib/auth/totp";
import { prisma } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/enums";

export async function makeUser(role: Role, opts: { totp?: boolean } = {}) {
  const totpSecretBase32 = opts.totp === false ? undefined : generateTotpSecret();
  const password = `pw-${randomUUID()}`;
  const user = await provisionOperator(prisma, {
    email: `${role.toLowerCase()}-${randomUUID()}@example.com`,
    name: `Test ${role}`,
    role,
    password,
    totpSecretBase32,
  });
  return { user, password, totpSecretBase32 };
}

/** A case with one owner and properties delivered on the given dates. */
export async function makeCase(deliveredDates: (Date | null)[]) {
  const owner = await prisma.owner.create({
    data: { fullName: "Test Owner", normalizedName: "TEST OWNER" },
  });
  return prisma.case.create({
    data: {
      ownerId: owner.id,
      properties: {
        create: deliveredDates.map((d) => ({
          statePropertyId: `TEST-${randomUUID()}`,
          ownerNameRaw: "ESTATE OF TEST OWNER",
          ownerId: owner.id,
          dateDeliveredToState: d,
          rawRecord: { test: true },
        })),
      },
    },
  });
}

export async function addDeathEvidence(caseId: string) {
  return prisma.evidence.create({
    data: { caseId, sourceType: "OBITUARY", supportsDeath: true, title: "Test obituary" },
  });
}

export async function addQualifiedHeir(caseId: string, evidenceId: string) {
  return prisma.person.create({
    data: {
      caseId,
      fullName: "Test Heir",
      normalizedName: "TEST HEIR",
      relationship: "CHILD",
      relationshipConfidence: 0.9,
      sourceEvidenceIds: [evidenceId],
    },
  });
}

/** Force a stage directly (test setup only — bypasses the state machine). */
export async function forceStage(caseId: string, stage: Parameters<typeof prisma.case.update>[0]["data"]["stage"]) {
  await prisma.case.update({ where: { id: caseId }, data: { stage } });
}
