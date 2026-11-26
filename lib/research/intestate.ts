/**
 * Intestate succession helper (build spec 5.4) — RESEARCH AID, NOT LEGAL
 * ADVICE. Suggests who likely has a claim when no living beneficiary is named,
 * using the configurable INTESTATE_SUCCESSION rule (Nevada: NRS 134).
 *
 * Shares are exact fractions. A deceased child's (or sibling's) share passes
 * to their own descendants per stirpes; descendants are linked to their parent
 * through Person.parentPersonId.
 */
import type { Relationship } from "@/lib/generated/prisma/enums";
import type { IntestateSuccessionParams } from "@/lib/rules/schemas";

export type Frac = [number, number];
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const norm = ([n, d]: Frac): Frac => {
  const g = gcd(n, d) || 1;
  return [n / g, d / g];
};
export const mul = (a: Frac, b: Frac): Frac => norm([a[0] * b[0], a[1] * b[1]]);
export const sub = (a: Frac, b: Frac): Frac => norm([a[0] * b[1] - b[0] * a[1], a[1] * b[1]]);
export const add = (a: Frac, b: Frac): Frac => norm([a[0] * b[1] + b[0] * a[1], a[1] * b[1]]);
export const fmt = ([n, d]: Frac) => (d === 1 ? `${n}` : `${n}/${d}`);
const ONE: Frac = [1, 1];

export type FamilyMember = {
  id: string;
  name: string;
  relationship: Relationship;
  isPredeceased: boolean;
  rejected: boolean;
  parentPersonId: string | null;
};

export type HeirShare = { personId: string; name: string; share: Frac; basis: string };

export type IntestateResult = {
  mode: "BENEFICIARY" | "INTESTATE" | "UNRESOLVED";
  heirs: HeirShare[];
  notes: string[];
  needsResearch: string[];
};

const DESCENDANT_OF: Partial<Record<Relationship, Relationship>> = { CHILD: "GRANDCHILD", SIBLING: "NIECE_NEPHEW" };

/** Split `share` among a line: the person if living, else their living descendants (recursively). */
function distributeLine(person: FamilyMember, share: Frac, people: FamilyMember[], basis: string, out: HeirShare[]): boolean {
  if (!person.isPredeceased) {
    out.push({ personId: person.id, name: person.name, share, basis });
    return true;
  }
  const descendants = people.filter((p) => p.parentPersonId === person.id && !p.rejected);
  const takers = descendants.filter((d) => hasLivingTaker(d, people));
  if (takers.length === 0) return false;
  const each: Frac = mul(share, [1, takers.length]);
  for (const d of takers) distributeLine(d, each, people, `${basis} → through ${person.name} (predeceased)`, out);
  return true;
}

function hasLivingTaker(p: FamilyMember, people: FamilyMember[]): boolean {
  if (!p.isPredeceased) return true;
  return people.filter((c) => c.parentPersonId === p.id && !c.rejected).some((c) => hasLivingTaker(c, people));
}

function lines(rel: Relationship, people: FamilyMember[]): FamilyMember[] {
  return people.filter((p) => p.relationship === rel && !p.rejected && hasLivingTaker(p, people));
}

function splitAmong(group: FamilyMember[], share: Frac, basis: string, people: FamilyMember[], out: HeirShare[]) {
  const each: Frac = mul(share, [1, group.length]);
  for (const g of group) distributeLine(g, each, people, basis, out);
}

export function suggestIntestateHeirs(all: FamilyMember[], params: IntestateSuccessionParams): IntestateResult {
  const people = all.filter((p) => !p.rejected);
  const notes: string[] = ["Research aid, not legal advice. A Nevada attorney should confirm who is entitled before any claim is filed."];
  const needs: string[] = [];
  const heirs: HeirShare[] = [];

  const beneficiaries = people.filter((p) => p.relationship === "NAMED_BENEFICIARY" && !p.isPredeceased);
  if (params.namedBeneficiaryFirst && beneficiaries.length > 0) {
    const each: Frac = [1, beneficiaries.length];
    for (const b of beneficiaries) heirs.push({ personId: b.id, name: b.name, share: each, basis: "named beneficiary on the policy" });
    notes.push("Life-insurance proceeds normally go to the living named beneficiary under the policy, not to the estate's heirs.");
    return { mode: "BENEFICIARY", heirs, notes, needsResearch: needs };
  }

  const spouse = people.find((p) => p.relationship === "SPOUSE" && !p.isPredeceased);
  const issue = lines("CHILD", people);
  // A predeceased child/sibling with no recorded descendants may still have a line we haven't found.
  for (const d of people.filter((x) => x.isPredeceased && DESCENDANT_OF[x.relationship])) {
    if (!people.some((c) => c.parentPersonId === d.id)) {
      needs.push(`Find out whether ${d.name} (predeceased) left children; link them to ${d.name} in the family tree.`);
    }
  }
  const unlinkedGrandchildren = people.filter((p) => p.relationship === "GRANDCHILD" && !p.parentPersonId);
  if (unlinkedGrandchildren.length && people.some((p) => p.relationship === "CHILD" && p.isPredeceased)) {
    needs.push(`Link ${unlinkedGrandchildren.map((g) => g.name).join(", ")} to their parent so their share can be worked out.`);
  }
  if (people.every((p) => p.relationship !== "CHILD") && people.every((p) => p.relationship !== "GRANDCHILD")) {
    needs.push("Confirm whether the owner had any children (including adopted children).");
  }

  if (spouse) {
    if (params.communityPropertyToSpouse) {
      notes.push(`If the money was community property, the surviving spouse (${spouse.name}) would generally take all of it.`);
    }
    if (issue.length > 0) {
      const spouseShare = issue.length === 1 ? params.spouseWithIssue.oneChildLine : params.spouseWithIssue.multipleChildLines;
      heirs.push({ personId: spouse.id, name: spouse.name, share: spouseShare as Frac, basis: "surviving spouse (separate property, with children)" });
      splitAmong(issue, sub(ONE, spouseShare as Frac), "child's line", people, heirs);
      return { mode: "INTESTATE", heirs, notes, needsResearch: needs };
    }
    for (const rule of params.spouseNoIssue) {
      const group = rule.withClass === "PARENTS"
        ? people.filter((p) => p.relationship === "PARENT" && !p.isPredeceased)
        : lines("SIBLING", people);
      if (group.length > 0) {
        heirs.push({ personId: spouse.id, name: spouse.name, share: rule.spouse as Frac, basis: `surviving spouse (no children; ${rule.withClass.toLowerCase()} survive)` });
        splitAmong(group, sub(ONE, rule.spouse as Frac), rule.withClass === "PARENTS" ? "parent" : "sibling's line", people, heirs);
        return { mode: "INTESTATE", heirs, notes, needsResearch: needs };
      }
    }
    heirs.push({ personId: spouse.id, name: spouse.name, share: ONE, basis: "surviving spouse (no children, parents or siblings found)" });
    needs.push("Confirm there are no surviving parents, siblings, or children of deceased siblings.");
    return { mode: "INTESTATE", heirs, notes, needsResearch: needs };
  }

  for (const cls of params.noSpouseOrder) {
    if (cls === "ISSUE" && issue.length) {
      splitAmong(issue, ONE, "child's line", people, heirs);
      return { mode: "INTESTATE", heirs, notes, needsResearch: needs };
    }
    if (cls === "PARENTS") {
      const parents = people.filter((p) => p.relationship === "PARENT" && !p.isPredeceased);
      if (parents.length) {
        splitAmong(parents, ONE, "parent", people, heirs);
        return { mode: "INTESTATE", heirs, notes, needsResearch: needs };
      }
    }
    if (cls === "SIBLINGS") {
      const sibs = lines("SIBLING", people);
      if (sibs.length) {
        splitAmong(sibs, ONE, "sibling's line", people, heirs);
        return { mode: "INTESTATE", heirs, notes, needsResearch: needs };
      }
    }
    if (cls === "GRANDPARENTS") {
      const gps = people.filter((p) => p.relationship === "GRANDPARENT" && !p.isPredeceased);
      if (gps.length) {
        splitAmong(gps, ONE, "grandparent", people, heirs);
        return { mode: "INTESTATE", heirs, notes, needsResearch: needs };
      }
    }
  }
  const kin = people.filter((p) => ["AUNT_UNCLE", "COUSIN"].includes(p.relationship) && !p.isPredeceased);
  if (kin.length) notes.push(`More distant relatives found (${kin.map((k) => k.name).join(", ")}); shares among next of kin need legal review.`);
  needs.push("No spouse, children, parents or siblings identified yet — keep researching the family before deciding.");
  return { mode: "UNRESOLVED", heirs, notes, needsResearch: needs };
}

/** Sanity check: shares should add up to 1 when the estate is fully allocated. */
export function totalShare(heirs: HeirShare[]): Frac {
  return heirs.reduce<Frac>((acc, h) => add(acc, h.share), [0, 1]);
}
