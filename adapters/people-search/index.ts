import "server-only";
import { MockPeopleSearchProvider } from "./mock";
import type { PeopleSearchProvider } from "./types";

export type { PeopleSearchMatch, PeopleSearchProvider, PeopleSearchQuery } from "./types";

/** The configured vendor, or null when none is contracted yet (manual entry still works). */
export function getPeopleSearchProvider(): PeopleSearchProvider | null {
  const mock = (process.env.MOCK_MODE ?? "true") !== "false";
  return mock ? new MockPeopleSearchProvider() : null;
}

/** Default wording; set PEOPLE_SEARCH_PERMISSIBLE_PURPOSE to the purpose in your vendor contract. */
export function permissiblePurpose(): string {
  return (
    process.env.PEOPLE_SEARCH_PERMISSIBLE_PURPOSE ??
    "Locating heirs/beneficiaries of a specific deceased owner's unclaimed property — confirm the matching GLBA/DPPA permissible purpose in your vendor agreement."
  );
}
