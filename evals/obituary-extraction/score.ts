/**
 * Scoring for the obituary-extraction eval.
 * Per case: 0.15 name + 0.15 date of death + 0.1 residence city + 0.6 relatives F1.
 * A relative matches when relationship and status are equal and every word of
 * the shorter name appears in the longer one ("Teresa" ~ "Teresa Ortega").
 * A non-obituary is scored only on isObituary + an empty relatives list.
 */
type Rel = { name: string; relationship: string; status: string };
export type Expected = {
  isObituary: boolean;
  fullName: string | null;
  dateOfDeath: string | null;
  residenceCity: string | null;
  relatives: Rel[];
};
export type Predicted = {
  isObituary: boolean;
  deceased: { fullName: string; dateOfDeath: string | null; residenceCity: string | null };
  relatives: Rel[];
};

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const sameName = (a: string, b: string) => {
  const [x, y] = [words(a), words(b)];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length > 0 && short.every((w) => long.includes(w));
};

export function scoreCase(expected: Expected, predicted: Predicted) {
  if (!expected.isObituary) {
    const ok = !predicted.isObituary && predicted.relatives.length === 0;
    return { score: ok ? 1 : 0, details: ok ? "correctly rejected" : "should not be treated as an obituary" };
  }
  const name = expected.fullName && sameName(expected.fullName, predicted.deceased.fullName) ? 1 : 0;
  const dod = (expected.dateOfDeath ?? null) === (predicted.deceased.dateOfDeath ?? null) ? 1 : 0;
  const city = (expected.residenceCity ?? "").toLowerCase() === (predicted.deceased.residenceCity ?? "").toLowerCase() ? 1 : 0;

  const unmatched = [...predicted.relatives];
  let tp = 0;
  const missed: string[] = [];
  for (const e of expected.relatives) {
    const idx = unmatched.findIndex((p) => p.relationship === e.relationship && p.status === e.status && sameName(e.name, p.name));
    if (idx >= 0) {
      tp++;
      unmatched.splice(idx, 1);
    } else missed.push(`${e.name}/${e.relationship}/${e.status}`);
  }
  const precision = predicted.relatives.length ? tp / predicted.relatives.length : expected.relatives.length ? 0 : 1;
  const recall = expected.relatives.length ? tp / expected.relatives.length : 1;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const score = 0.15 * name + 0.15 * dod + 0.1 * city + 0.6 * f1;
  const extra = unmatched.map((p) => `${p.name}/${p.relationship}/${p.status}`);
  return {
    score,
    details: `name ${name} · death date ${dod} · city ${city} · relatives F1 ${f1.toFixed(2)}` +
      (missed.length ? ` · missed: ${missed.join(", ")}` : "") +
      (extra.length ? ` · extra: ${extra.join(", ")}` : ""),
  };
}
