/**
 * Do-not-contact list, honored across ALL cases (spec 5.6). Entries store
 * keyed hashes (blind indexes) of the email and the normalized street address,
 * never the plaintext, plus the normalized name for display and name-only
 * entries. A match on email or address (the whole household) blocks drafting,
 * approval and sending.
 */
import "server-only";
import { writeAudit, type Actor } from "@/lib/audit";
import { blindIndex } from "@/lib/crypto/pii";
import { prisma, type DbClient } from "@/lib/db";
import { normalizeAddress } from "@/lib/normalize/address";
import { normalizeWhitespaceUpper } from "./util";

export function emailHashOf(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? blindIndex(e) : null;
}

/** Hash of street line + ZIP5 (USPS-normalized), so formatting differences still match. */
export function addressHashOf(address: string | { line1: string; line2?: string; city: string; state: string; zip: string } | null | undefined): string | null {
  if (!address) return null;
  const n =
    typeof address === "string"
      ? normalizeAddress({ kind: "single", value: address })
      : normalizeAddress({ kind: "parts", line1: address.line1, line2: address.line2, city: address.city, state: address.state, zip: address.zip });
  if (!n.line1 || !n.zip5) return null;
  return blindIndex(`${n.line1}|${n.line2 ?? ""}|${n.zip5}`);
}

export type DncCheck = { blocked: boolean; reason: string | null; entryId: string | null };

export async function checkDoNotContact(
  db: DbClient,
  q: { normalizedName?: string | null; emailHash?: string | null; addressHash?: string | null },
): Promise<DncCheck> {
  const or: object[] = [];
  if (q.emailHash) or.push({ emailHash: q.emailHash });
  if (q.addressHash) or.push({ addressHash: q.addressHash });
  if (q.normalizedName) or.push({ normalizedName: q.normalizedName, emailHash: null, addressHash: null });
  if (or.length === 0) return { blocked: false, reason: null, entryId: null };
  const hit = await db.doNotContact.findFirst({ where: { OR: or }, orderBy: { createdAt: "asc" } });
  if (!hit) return { blocked: false, reason: null, entryId: null };
  const how = q.emailHash && hit.emailHash === q.emailHash ? "email address" : q.addressHash && hit.addressHash === q.addressHash ? "mailing address" : "name";
  return { blocked: true, reason: `Do-not-contact list (matched by ${how}, added ${hit.createdAt.toISOString().slice(0, 10)}: ${hit.reason}).`, entryId: hit.id };
}

export type DncInput = { name?: string | null; email?: string | null; address?: string | null; reason: string };

export async function addDoNotContact(db: DbClient, actor: Actor, input: DncInput & { createdById?: string | null }) {
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new Error("Give a reason (e.g. \"Asked by phone not to be contacted\").");
  const normalizedName = input.name?.trim() ? normalizeWhitespaceUpper(input.name) : null;
  const emailHash = emailHashOf(input.email);
  const addressHash = addressHashOf(input.address);
  if (!normalizedName && !emailHash && !addressHash) throw new Error("Enter a name, an email address or a full street address with ZIP.");
  const existing = await db.doNotContact.findFirst({
    where: { normalizedName, emailHash, addressHash },
  });
  if (existing) return existing;
  const entry = await db.doNotContact.create({
    data: { normalizedName, emailHash, addressHash, reason, createdById: input.createdById ?? null },
  });
  await writeAudit(db, {
    actor,
    action: "dnc.added",
    entityType: "DoNotContact",
    entityId: entry.id,
    after: { hasName: Boolean(normalizedName), hasEmailHash: Boolean(emailHash), hasAddressHash: Boolean(addressHash), reason },
  });
  return entry;
}

export async function removeDoNotContact(actor: { id: string; role: string }, id: string, reason: string) {
  if (actor.role !== "OWNER") throw new Error("Only the OWNER can remove a do-not-contact entry.");
  if (reason.trim().length < 10) throw new Error("Removing an entry needs a written reason (at least 10 characters).");
  await prisma.$transaction(async (tx) => {
    const entry = await tx.doNotContact.delete({ where: { id } });
    await writeAudit(tx, {
      actor: { type: "USER", id: actor.id, role: actor.role },
      action: "dnc.removed",
      entityType: "DoNotContact",
      entityId: id,
      before: { normalizedName: entry.normalizedName, reason: entry.reason, createdAt: entry.createdAt },
      reason: reason.trim(),
    });
  });
}
