/** A source of death records / obituaries searchable by owner details (build spec 5.3). */
export type DeathRecordQuery = {
  fullName: string;
  aliases: string[];
  city: string | null;
  state: string | null;
  /** Approximate birth year if known (from DOB or an age). */
  birthYear: number | null;
};

export type DeathRecordResult = {
  sourceName: string;
  sourceType: "OBITUARY" | "DEATH_RECORD_INDEX";
  title: string;
  url: string | null;
  /** Full text when the source licenses it; otherwise a snippet. */
  text: string;
  retrievedAt: Date;
};

export interface DeathRecordSource {
  readonly id: string;
  readonly name: string;
  search(query: DeathRecordQuery): Promise<DeathRecordResult[]>;
}
