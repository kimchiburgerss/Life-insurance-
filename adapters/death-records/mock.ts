/**
 * Mock death-record source: returns a deterministic, clearly FICTIONAL obituary
 * for the owner so the research flow can be exercised end to end.
 */
import { createHash } from "node:crypto";
import type { DeathRecordQuery, DeathRecordResult, DeathRecordSource } from "./types";

const FIRST = ["Margaret", "Eleanor", "Walter", "Ruth", "Arthur", "Doris", "Frank", "Irene", "Howard", "Lillian", "Ray", "Joan"];
const KIDS = ["Daniel", "Laura", "Steven", "Karen", "Michael", "Susan", "Brian", "Denise", "Gary", "Paula"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function pick<T>(list: T[], seed: number, i: number): T {
  return list[(seed + i * 7) % list.length]!;
}

export class MockDeathRecordSource implements DeathRecordSource {
  readonly id = "mock-obituaries";
  readonly name = "Demo obituary source (fictional)";

  async search(q: DeathRecordQuery): Promise<DeathRecordResult[]> {
    if (!q.fullName.trim() || /\b(INC|LLC|CORP|TRUST|UNKNOWN)\b/i.test(q.fullName)) return [];
    const seed = createHash("sha256").update(q.fullName.toUpperCase()).digest().readUInt32BE(0);
    const parts = q.fullName.split(/\s+/);
    const last = parts[parts.length - 1]!;
    const first = parts[0]!;
    const city = q.city ? q.city.replace(/\b\w+/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()) : "Las Vegas";
    const year = 2015 + (seed % 9);
    const month = MONTHS[seed % 12]!;
    const day = 1 + (seed % 27);
    const age = q.birthYear ? year - q.birthYear : 70 + (seed % 25);
    const spouse = `${pick(FIRST, seed, 1)} ${last}`;
    const child1 = `${pick(KIDS, seed, 2)} ${last}`;
    const child2 = `${pick(KIDS, seed, 3)} ${pick(["Hale", "Moreno", "Fischer", "Banks"], seed, 4)}`;
    const sibling = `${pick(FIRST, seed, 5)} ${last}`;
    const spouseLate = seed % 3 === 0;
    const text =
      `${q.fullName}, ${age}, of ${city}, Nevada, passed away on ${month} ${day}, ${year}. ` +
      `${first} worked for many years in ${city} and loved family gatherings. ` +
      (spouseLate
        ? `${first} is survived by ${first.endsWith("a") ? "her" : "his"} children, ${child1} and ${child2}. ${first} was preceded in death by ${first.endsWith("a") ? "her" : "his"} spouse, ${spouse}, and sibling, ${sibling}.`
        : `${first} is survived by ${first.endsWith("a") ? "her" : "his"} spouse, ${spouse}; children, ${child1} and ${child2}; and sibling, ${sibling}.`) +
      ` (FICTIONAL DEMO OBITUARY — not a real person.)`;
    return [
      {
        sourceName: this.name,
        sourceType: "OBITUARY",
        title: `Obituary — ${q.fullName} (demo)`,
        url: `https://obituaries.example.com/${encodeURIComponent(q.fullName.toLowerCase().replace(/\s+/g, "-"))}`,
        text,
        retrievedAt: new Date(),
      },
    ];
  }
}
