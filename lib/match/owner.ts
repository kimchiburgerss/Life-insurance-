/**
 * Probable-owner matching (build spec 5.1): decide whether a newly imported
 * record belongs to an existing owner.
 *
 * - Order-insensitive: "SMITH JOHN A" and "JOHN A SMITH" compare equal, because
 *   single-field names in state files are often in LAST FIRST order.
 * - Nickname-aware (BILL ≈ WILLIAM) and initial-aware (A ≈ ALLEN).
 * - Conflicting generational suffixes (JR vs SR) or middle names are strong
 *   negative evidence (father/son with the same name are common).
 * - Address agreement (ZIP, house number, street) raises confidence; a name
 *   match without any address agreement is never auto-merged.
 */
import type { NormalizedAddress } from "@/lib/normalize/address";
import { areNicknameEquivalent, canonicalGivenName } from "./nicknames";
import { jaroWinkler, soundex } from "./similarity";

export type MatchableOwner = {
  /** Name tokens without suffix/titles, e.g. ["JOHN","A","SMITH"]. */
  tokens: string[];
  suffix: string | null;
  address: Pick<NormalizedAddress, "zip5" | "streetNumber" | "streetName" | "isPoBox"> | null;
};

export type MatchDecision = "AUTO" | "REVIEW" | "NONE";

export type MatchResult = {
  score: number;
  decision: MatchDecision;
  reasons: string[];
};

/** Thresholds (documented in COMPLIANCE.md). Tuned to prefer review over wrong merges. */
export const AUTO_MERGE_THRESHOLD = 0.93;
export const REVIEW_THRESHOLD = 0.8;

const isInitial = (t: string) => t.length === 1;

/** Blocking keys: unordered pairs of Soundex codes of the (canonical) name tokens. */
export function ownerMatchKeys(tokens: string[]): string[] {
  const full = [...new Set(tokens.filter((t) => t.length > 1).map((t) => soundex(canonicalGivenName(t))))].filter(Boolean);
  if (full.length === 0) return [];
  if (full.length === 1) return [`P:${full[0]}`];
  const keys: string[] = [];
  for (let i = 0; i < full.length; i++)
    for (let j = i + 1; j < full.length; j++) keys.push(`P:${[full[i], full[j]].sort().join("|")}`);
  return keys;
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (isInitial(a) || isInitial(b)) return a[0] === b[0] ? 0.9 : 0;
  if (areNicknameEquivalent(a, b)) return 0.95;
  return jaroWinkler(a, b);
}

/** Best one-to-one alignment of full-name tokens (greedy is fine for ≤ 5 tokens). */
function nameSimilarity(a: string[], b: string[]): { score: number; reasons: string[]; conflict: boolean } {
  const reasons: string[] = [];
  const fullA = a.filter((t) => !isInitial(t));
  const fullB = b.filter((t) => !isInitial(t));
  if (fullA.length === 0 || fullB.length === 0) return { score: 0, reasons: ["name too short to compare"], conflict: false };

  const [short, long] = fullA.length <= fullB.length ? [fullA, fullB] : [fullB, fullA];
  const used = new Set<number>();
  let total = 0;
  for (const t of short) {
    let best = 0;
    let bestIdx = -1;
    long.forEach((u, idx) => {
      if (used.has(idx)) return;
      const s = tokenSimilarity(t, u);
      if (s > best) {
        best = s;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    if (best >= 0.95 && best < 1 && bestIdx >= 0 && areNicknameEquivalent(t, long[bestIdx]!)) {
      reasons.push(`nickname ${t} ≈ ${long[bestIdx]}`);
    }
    total += best;
  }
  let score = total / short.length;
  // Extra unmatched full-name tokens (e.g. a middle name on one side only) cost a little.
  const extra = long.length - short.length;
  if (extra > 0) score -= 0.02 * extra;

  // Middle initials / names that clearly disagree.
  let conflict = false;
  const initialsA = a.filter(isInitial);
  const initialsB = b.filter(isInitial);
  if (initialsA.length && initialsB.length && !initialsA.some((i) => initialsB.includes(i))) {
    conflict = true;
    reasons.push(`middle initials differ (${initialsA.join("")} vs ${initialsB.join("")})`);
  }
  return { score: Math.max(0, Math.min(1, score)), reasons, conflict };
}

function addressAgreement(a: MatchableOwner["address"], b: MatchableOwner["address"]) {
  if (!a || !b || (!a.zip5 && !a.streetName) || (!b.zip5 && !b.streetName)) {
    return { known: false, sameZip: false, sameStreet: false, sameNumber: false };
  }
  const sameZip = Boolean(a.zip5 && b.zip5 && a.zip5 === b.zip5);
  const sameNumber = Boolean(a.streetNumber && b.streetNumber && a.streetNumber === b.streetNumber);
  const sameStreet = Boolean(a.streetName && b.streetName && jaroWinkler(a.streetName, b.streetName) >= 0.9);
  return { known: true, sameZip, sameStreet, sameNumber };
}

export function scoreOwnerMatch(a: MatchableOwner, b: MatchableOwner): MatchResult {
  const name = nameSimilarity(a.tokens, b.tokens);
  const reasons = [`name similarity ${(name.score * 100).toFixed(0)}%`, ...name.reasons];
  let score = name.score;

  if (a.suffix && b.suffix && a.suffix !== b.suffix) {
    score -= 0.3;
    reasons.push(`different suffix (${a.suffix} vs ${b.suffix}) — possibly parent and child`);
  }
  if (name.conflict) score -= 0.15;

  const addr = addressAgreement(a.address, b.address);
  if (addr.known) {
    if (addr.sameNumber && addr.sameStreet) {
      score += 0.06;
      reasons.push("same street address");
    } else if (addr.sameZip) {
      score += 0.03;
      reasons.push("same ZIP code");
    } else {
      score -= 0.08;
      reasons.push("addresses differ");
    }
  } else {
    reasons.push("address missing on one side");
  }
  score = Math.max(0, Math.min(1, score));

  // Auto-merge only on strong evidence: the same street address, or an exact
  // name (no nickname/typo tolerance) in the same ZIP. Everything else that
  // looks similar goes to a human.
  const exactName = name.score >= 0.999;
  const sameStreetAddress = addr.known && addr.sameNumber && addr.sameStreet;
  const suffixConflict = Boolean(a.suffix && b.suffix && a.suffix !== b.suffix);
  let decision: MatchDecision = "NONE";
  if (
    score >= AUTO_MERGE_THRESHOLD &&
    !name.conflict &&
    !suffixConflict &&
    (sameStreetAddress || (exactName && addr.sameZip))
  ) {
    decision = "AUTO";
  } else if (score >= REVIEW_THRESHOLD) {
    decision = "REVIEW";
  }
  return { score: Math.round(score * 1000) / 1000, decision, reasons };
}
