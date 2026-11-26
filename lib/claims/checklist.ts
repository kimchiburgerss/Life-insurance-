/**
 * Which documents this claim needs and where each one stands (pure).
 *
 * Items come from the active CLAIM_REQUIREMENTS rule (configurable, spec 5.8).
 * Whether a conditional item applies depends on the packet's facts — small
 * estate or probate, will or no will, spouse claimant, several heirs — which
 * the operator confirms. An unknown fact never silently drops a document.
 */
import type { ClaimApplicability, ClaimRequirementsParams } from "@/lib/rules/schemas";

export type PacketFacts = {
  estatePath: "SMALL_ESTATE" | "PROBATE" | null;
  hasWill: boolean | null;
  spouseClaimant: boolean;
  multipleHeirs: boolean;
};

export type ItemDecision = { key: string; status: "NOT_APPLICABLE" | "WAIVED"; reason: string };

export type DocRef = {
  documentId: string;
  key: string;
  fileId: string;
  fileName: string;
  contentType: string;
  status: "RECEIVED" | "ACCEPTED" | "NEEDS_REPLACEMENT";
  uploadedAt: string;
};

export type RowStatus = "MISSING" | "RECEIVED" | "ACCEPTED" | "NEEDS_REPLACEMENT" | "NOT_APPLICABLE" | "WAIVED" | "UNDECIDED";

export type ChecklistRow = {
  key: string;
  label: string;
  form: string | null;
  required: boolean;
  inPacket: boolean;
  applies: boolean | "UNKNOWN";
  why: string;
  status: RowStatus;
  decisionReason: string | null;
  documents: DocRef[];
};

type Item = ClaimRequirementsParams["checklist"][number];

function tagHolds(tag: ClaimApplicability, f: PacketFacts): boolean | "UNKNOWN" {
  switch (tag) {
    case "SMALL_ESTATE":
      return f.estatePath === null ? "UNKNOWN" : f.estatePath === "SMALL_ESTATE";
    case "PROBATE":
      return f.estatePath === null ? "UNKNOWN" : f.estatePath === "PROBATE";
    case "SPOUSE_CLAIMANT":
      return f.spouseClaimant;
    case "NOT_SPOUSE_CLAIMANT":
      return !f.spouseClaimant;
    case "NO_WILL":
      return f.hasWill === null ? "UNKNOWN" : !f.hasWill;
    case "HAS_WILL":
      return f.hasWill === null ? "UNKNOWN" : f.hasWill;
    case "MULTIPLE_HEIRS":
      return f.multipleHeirs;
  }
}

/** All tags must hold; any definite "no" wins over "unknown". */
export function applicability(item: Item, f: PacketFacts): { applies: boolean | "UNKNOWN"; why: string } {
  const tags = item.appliesWhen ?? [];
  if (tags.length === 0) return { applies: true, why: "Always needed." };
  const results = tags.map((t) => tagHolds(t, f));
  if (results.includes(false)) return { applies: false, why: `Not needed: ${item.condition ?? tags.join(" + ").toLowerCase()}.` };
  if (results.includes("UNKNOWN")) return { applies: "UNKNOWN", why: `Depends on facts not confirmed yet (${item.condition ?? tags.join(", ").toLowerCase()}).` };
  return { applies: true, why: item.condition ? `Needed: ${item.condition}.` : "Needed." };
}

export function buildPacketChecklist(input: {
  items: Item[];
  facts: PacketFacts;
  documents: DocRef[];
  decisions: ItemDecision[];
  /** Our signed agreement satisfies the agreement_copy item automatically. */
  signedAgreementFileId: string | null;
}): ChecklistRow[] {
  return input.items.map((item) => {
    const { applies, why } = applicability(item, input.facts);
    const docs = input.documents.filter((d) => d.key === item.key);
    const decision = input.decisions.find((d) => d.key === item.key) ?? null;
    let status: RowStatus;
    if (decision) status = decision.status;
    else if (applies === false) status = "NOT_APPLICABLE";
    else if (item.key === "agreement_copy") status = input.signedAgreementFileId ? "ACCEPTED" : "MISSING";
    else if (docs.some((d) => d.status === "ACCEPTED")) status = "ACCEPTED";
    else if (docs.some((d) => d.status === "RECEIVED")) status = "RECEIVED";
    else if (docs.some((d) => d.status === "NEEDS_REPLACEMENT")) status = "NEEDS_REPLACEMENT";
    else if (applies === "UNKNOWN") status = "UNDECIDED";
    else status = "MISSING";
    return {
      key: item.key,
      label: item.label,
      form: item.form ?? null,
      required: item.required,
      inPacket: item.inPacket !== false,
      applies,
      why,
      status,
      decisionReason: decision?.reason ?? null,
      documents: docs,
    };
  });
}

/** Ready to assemble/approve: every needed, required item is accepted (or waived with a reason). */
export function packetReadiness(rows: ChecklistRow[]): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];
  for (const r of rows) {
    if (!r.required || r.status === "NOT_APPLICABLE" || r.status === "WAIVED" || r.status === "ACCEPTED") continue;
    if (r.status === "UNDECIDED") blockers.push(`${r.label}: confirm the estate facts first.`);
    else if (r.status === "RECEIVED") blockers.push(`${r.label}: review the uploaded document.`);
    else if (r.status === "NEEDS_REPLACEMENT") blockers.push(`${r.label}: waiting for a new copy.`);
    else blockers.push(`${r.label}: missing.`);
  }
  return { ready: blockers.length === 0, blockers };
}

/** Documents that go into the PDF, in checklist order (accepted ones only). */
export function packetContents(rows: ChecklistRow[]): { key: string; label: string; doc: DocRef }[] {
  return rows
    .filter((r) => r.inPacket && r.status === "ACCEPTED")
    .flatMap((r) => r.documents.filter((d) => d.status === "ACCEPTED").map((doc) => ({ key: r.key, label: r.label, doc })));
}
