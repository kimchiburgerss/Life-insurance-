export function caseRef(caseNumber: number, stateCode = "NV"): string {
  return `${stateCode}-${String(caseNumber).padStart(6, "0")}`;
}

/** Parse "NV-000042", "nv42" or "42" into a case number. */
export function parseCaseRef(value: string): number | null {
  const m = /^(?:[A-Z]{2}-?)?0*(\d{1,9})$/i.exec(value.trim());
  return m ? Number(m[1]) : null;
}

export function formatUsd(cents: number | null | undefined, opts: { exact?: boolean } = {}): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts.exact ? 2 : 0,
    minimumFractionDigits: opts.exact ? 2 : 0,
  });
}

export function formatPct(fraction: number | null | undefined): string {
  return fraction === null || fraction === undefined ? "—" : `${Math.round(fraction * 100)}%`;
}

export function scoreTone(score: number | null | undefined): "good" | "warn" | "bad" | "neutral" {
  if (score === null || score === undefined) return "neutral";
  if (score >= 70) return "good";
  if (score >= 40) return "warn";
  return "bad";
}
