/**
 * Grouping review queue: a human decides whether an uncertain match is the
 * same person. Nothing is merged without this decision (build spec 5.1, 5.4).
 */
import "server-only";
import { writeAudit } from "@/lib/audit";
import type { Role } from "@/lib/generated/prisma/enums";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { todayIn } from "@/lib/dates";
import { rescoreCases } from "@/lib/screening/service";
import { OPEN_FOR_NEW_PROPERTIES } from "./process";

export class ReviewError extends Error {}

/** Provisional cases that are this far along have had real work; merging them must be manual. */
const MERGEABLE_PROVISIONAL_STAGES = ["IMPORTED", "SCREENED"] as const;

export async function decideOwnerMatch(input: {
  candidateId: string;
  decision: "MERGE" | "SEPARATE";
  actor: { id: string; role: Role };
  ipAddress?: string;
}) {
  if (!can(input.actor.role, "owners:merge")) throw new ForbiddenError();
  const today = todayIn();

  const result = await prisma.$transaction(async (tx) => {
    const c = await tx.ownerMatchCandidate.findUniqueOrThrow({
      where: { id: input.candidateId },
      include: {
        newOwner: { include: { cases: { select: { id: true, stage: true } } } },
        existingOwner: { select: { id: true, aliases: true, lastKnownAddresses: true, matchKeys: true, mergedIntoId: true } },
      },
    });
    if (c.status !== "PENDING") throw new ReviewError("This match has already been decided.");
    const audit = { actor: { type: "USER" as const, id: input.actor.id, role: input.actor.role }, ipAddress: input.ipAddress };

    if (input.decision === "SEPARATE") {
      await tx.ownerMatchCandidate.update({
        where: { id: c.id },
        data: { status: "REJECTED", decidedById: input.actor.id, decidedAt: new Date() },
      });
      await writeAudit(tx, { ...audit, action: "owner.match_rejected", entityType: "OwnerMatchCandidate", entityId: c.id, after: { score: c.score } });
      return { caseIds: [] as string[] };
    }

    if (c.existingOwner.mergedIntoId) throw new ReviewError("The existing owner was itself merged into another owner. Refresh the queue.");
    const worked = c.newOwner.cases.filter((cs) => !(MERGEABLE_PROVISIONAL_STAGES as readonly string[]).includes(cs.stage));
    if (worked.length > 0) {
      throw new ReviewError(`The new owner's case is already at ${worked[0]!.stage}; merge it manually so no work is lost.`);
    }
    const provisionalCaseIds = c.newOwner.cases.map((cs) => cs.id);
    const [evidence, persons, comms] = await Promise.all([
      tx.evidence.count({ where: { caseId: { in: provisionalCaseIds } } }),
      tx.person.count({ where: { caseId: { in: provisionalCaseIds } } }),
      tx.communication.count({ where: { caseId: { in: provisionalCaseIds } } }),
    ]);
    if (evidence + persons + comms > 0) {
      throw new ReviewError("The new owner's case already has evidence, heirs or communications; merge it manually.");
    }

    const target = await tx.case.findFirst({
      where: { ownerId: c.existingOwnerId, stage: { in: OPEN_FOR_NEW_PROPERTIES } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    let targetCaseId: string;
    if (target) {
      targetCaseId = target.id;
      await tx.property.updateMany({ where: { ownerId: c.newOwnerId }, data: { ownerId: c.existingOwnerId, caseId: target.id } });
      await tx.case.deleteMany({ where: { id: { in: provisionalCaseIds } } });
      for (const id of provisionalCaseIds) {
        await writeAudit(tx, { ...audit, action: "case.merged_into", entityType: "Case", entityId: id, after: { mergedIntoCaseId: target.id } });
      }
    } else {
      // Existing owner has no open case: the provisional case moves to them.
      targetCaseId = provisionalCaseIds[0]!;
      await tx.case.updateMany({ where: { id: { in: provisionalCaseIds } }, data: { ownerId: c.existingOwnerId } });
      await tx.property.updateMany({ where: { ownerId: c.newOwnerId }, data: { ownerId: c.existingOwnerId } });
    }

    await tx.owner.update({
      where: { id: c.existingOwnerId },
      data: {
        aliases: [...new Set([...c.existingOwner.aliases, ...c.newOwner.aliases])],
        lastKnownAddresses: [
          ...(Array.isArray(c.existingOwner.lastKnownAddresses) ? c.existingOwner.lastKnownAddresses : []),
          ...(Array.isArray(c.newOwner.lastKnownAddresses) ? c.newOwner.lastKnownAddresses : []),
        ] as never,
        matchKeys: [...new Set([...c.existingOwner.matchKeys, ...c.newOwner.matchKeys])],
      },
    });
    await tx.owner.update({ where: { id: c.newOwnerId }, data: { mergedIntoId: c.existingOwnerId, matchKeys: [] } });
    await tx.ownerMatchCandidate.update({
      where: { id: c.id },
      data: { status: "MERGED", decidedById: input.actor.id, decidedAt: new Date() },
    });
    // Any other open suggestion about the merged owner is now moot.
    await tx.ownerMatchCandidate.updateMany({
      where: { status: "PENDING", OR: [{ newOwnerId: c.newOwnerId }, { existingOwnerId: c.newOwnerId }] },
      data: { status: "REJECTED", decidedById: input.actor.id, decidedAt: new Date() },
    });
    await writeAudit(tx, {
      ...audit,
      action: "owner.merged",
      entityType: "Owner",
      entityId: c.existingOwnerId,
      before: { mergedOwnerId: c.newOwnerId, provisionalCaseIds },
      after: { targetCaseId, score: c.score },
    });
    await rescoreCases(tx, [targetCaseId], today);
    return { caseIds: [targetCaseId] };
  });
  return result;
}
