/**
 * People-search / skip-tracing vendor interface (build spec 5.4). Every lookup
 * must state the permissible purpose agreed in the vendor contract
 * (GLBA/DPPA); it is recorded in the audit log.
 */
export type PeopleSearchQuery = {
  fullName: string;
  city: string | null;
  state: string | null;
  /** Names of known relatives — vendors use them to disambiguate. */
  relativeNames: string[];
  permissiblePurpose: string;
};

export type PeopleSearchMatch = {
  vendorRecordId: string;
  fullName: string;
  ageRange: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** Vendor's own match confidence, 0–1, if provided. */
  confidence: number | null;
  relativesOnFile: string[];
};

export interface PeopleSearchProvider {
  readonly id: string;
  readonly name: string;
  lookup(query: PeopleSearchQuery): Promise<PeopleSearchMatch[]>;
}
