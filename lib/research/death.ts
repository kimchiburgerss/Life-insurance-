/**
 * "Is this obituary about our owner?" — an explainable confidence (build spec
 * 5.3: show confidence and why). Pure function; the researcher decides.
 */
import { addMonths, parseDateOnly } from "@/lib/dates";
import { scoreOwnerMatch } from "@/lib/match/owner";
import { parseOwnerName } from "@/lib/normalize/name";
import { cleanText } from "@/lib/normalize/text";
import type { ObituaryExtraction } from "./obituary";

export type DeathMatchOwner = {
  fullName: string;
  aliases: string[];
  dateOfBirth: Date | null;
  /** Cities from last-known addresses (any case). */
  cities: string[];
  /** Latest date any property was presumed abandoned or delivered (death usually precedes it). */
  latestPropertyDate: Date | null;
};

export type DeathMatch = {
  confidence: number; // 0–1
  verdict: "STRONG" | "POSSIBLE" | "WEAK";
  factors: { label: string; effect: "+" | "−" | "·" }[];
};

export function assessDeathMatch(owner: DeathMatchOwner, ext: ObituaryExtraction): DeathMatch {
  const factors: DeathMatch["factors"] = [];
  if (!ext.isObituary) {
    return { confidence: 0, verdict: "WEAK", factors: [{ label: "the text does not look like an obituary or death notice", effect: "−" }] };
  }

  // Name: best of the owner's name and aliases vs the deceased's name and other names.
  const deceasedNames = [ext.deceased.fullName, ...ext.deceased.otherNames.map((n) => `${ext.deceased.fullName.split(" ")[0]} ${n}`)];
  let nameScore = 0;
  for (const ownerName of [owner.fullName, ...owner.aliases]) {
    const o = parseOwnerName(ownerName, "FIRST_LAST");
    for (const dn of deceasedNames) {
      const d = parseOwnerName(dn, "FIRST_LAST");
      const r = scoreOwnerMatch({ tokens: o.tokens, suffix: o.suffix, address: null }, { tokens: d.tokens, suffix: d.suffix, address: null });
      nameScore = Math.max(nameScore, r.score);
    }
  }
  let confidence = nameScore * 0.6;
  factors.push({ label: `name similarity ${Math.round(nameScore * 100)}%`, effect: nameScore >= 0.9 ? "+" : nameScore >= 0.75 ? "·" : "−" });

  // Place
  const city = cleanText(ext.deceased.residenceCity);
  if (city && owner.cities.map((c) => cleanText(c)).includes(city)) {
    confidence += 0.2;
    factors.push({ label: `lived in ${ext.deceased.residenceCity}, a last-known city of the owner`, effect: "+" });
  } else if (city) {
    factors.push({ label: `lived in ${ext.deceased.residenceCity}; owner's known cities: ${owner.cities.join(", ") || "none"}`, effect: "·" });
  } else {
    factors.push({ label: "obituary does not say where the person lived", effect: "·" });
  }

  // Date of birth / age consistency
  if (owner.dateOfBirth && ext.deceased.dateOfBirth) {
    const same = ext.deceased.dateOfBirth === owner.dateOfBirth.toISOString().slice(0, 10);
    confidence += same ? 0.15 : -0.3;
    factors.push({ label: same ? "date of birth matches" : "date of birth does NOT match", effect: same ? "+" : "−" });
  } else if (owner.dateOfBirth && ext.deceased.age !== null && ext.deceased.dateOfDeath) {
    const birthYear = owner.dateOfBirth.getUTCFullYear();
    const impliedAge = Number(ext.deceased.dateOfDeath.slice(0, 4)) - birthYear;
    const ok = Math.abs(impliedAge - ext.deceased.age) <= 1;
    confidence += ok ? 0.1 : -0.25;
    factors.push({ label: ok ? "stated age fits the owner's birth year" : `stated age ${ext.deceased.age} does not fit birth year ${birthYear}`, effect: ok ? "+" : "−" });
  }

  // Timing: the property should become unclaimed after the death (allow 6 months slack).
  if (ext.deceased.dateOfDeath && owner.latestPropertyDate) {
    try {
      const dod = parseDateOnly(ext.deceased.dateOfDeath);
      const plausible = addMonths(dod, -6, "clamp") <= owner.latestPropertyDate;
      confidence += plausible ? 0.05 : -0.2;
      factors.push({
        label: plausible ? "date of death fits the property timeline" : "death date is long after the property went unclaimed",
        effect: plausible ? "+" : "−",
      });
    } catch {
      factors.push({ label: `date of death "${ext.deceased.dateOfDeath}" could not be read`, effect: "·" });
    }
  } else if (!ext.deceased.dateOfDeath) {
    factors.push({ label: "no date of death in the text", effect: "·" });
  }

  confidence = Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;
  const verdict = confidence >= 0.75 ? "STRONG" : confidence >= 0.5 ? "POSSIBLE" : "WEAK";
  return { confidence, verdict, factors };
}
