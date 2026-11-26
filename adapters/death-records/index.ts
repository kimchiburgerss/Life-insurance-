import "server-only";
import { MockDeathRecordSource } from "./mock";
import type { DeathRecordSource } from "./types";

export type { DeathRecordQuery, DeathRecordResult, DeathRecordSource } from "./types";

/** Configured sources. Real licensed sources are registered here once contracted. */
export function getDeathRecordSources(): DeathRecordSource[] {
  const mock = (process.env.MOCK_MODE ?? "true") !== "false";
  return mock ? [new MockDeathRecordSource()] : [];
}
