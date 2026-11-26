/** Mock people-search vendor: deterministic FICTIONAL results (example.com, 555-01xx). */
import { createHash } from "node:crypto";
import type { PeopleSearchMatch, PeopleSearchProvider, PeopleSearchQuery } from "./types";

const STREETS = ["Desert Willow Dr", "Sandstone Ct", "Juniper Ridge Rd", "Silver Spur Ln", "Canyon Mist Ave"];
const CITIES = [
  ["Las Vegas", "89123"],
  ["Henderson", "89052"],
  ["Reno", "89509"],
  ["Carson City", "89703"],
] as const;

export class MockPeopleSearchProvider implements PeopleSearchProvider {
  readonly id = "mock-people-search";
  readonly name = "Demo people-search vendor (fictional)";

  async lookup(q: PeopleSearchQuery): Promise<PeopleSearchMatch[]> {
    if (!q.permissiblePurpose.trim()) throw new Error("A permissible purpose is required for every lookup.");
    const seed = createHash("sha256").update(q.fullName.toUpperCase()).digest().readUInt32BE(0);
    const [city, zip] = CITIES[seed % CITIES.length]!;
    const handle = q.fullName.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
    const best: PeopleSearchMatch = {
      vendorRecordId: `MOCK-${seed.toString(16).toUpperCase()}`,
      fullName: q.fullName.toUpperCase(),
      ageRange: `${40 + (seed % 30)}-${44 + (seed % 30)}`,
      address: `${100 + (seed % 9800)} ${STREETS[seed % STREETS.length]}, ${city}, NV ${zip}`,
      phone: `702-555-01${String(seed % 100).padStart(2, "0")}`,
      email: `${handle}@example.com`,
      confidence: 0.86,
      relativesOnFile: q.relativeNames.slice(0, 2),
    };
    const weaker: PeopleSearchMatch = {
      ...best,
      vendorRecordId: `${best.vendorRecordId}-2`,
      ageRange: `${70 + (seed % 15)}-${74 + (seed % 15)}`,
      address: `PO Box ${1000 + (seed % 8000)}, Elko, NV 89801`,
      phone: null,
      email: null,
      confidence: 0.41,
      relativesOnFile: [],
    };
    return [best, weaker];
  }
}
