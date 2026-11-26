/** Pure unit-economics helpers. */
export function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/** Break-even cases per month = fixed monthly cost ÷ (revenue − variable cost) per closed case. */
export function breakEvenCasesPerMonth(monthlyFixedCents: number, revenuePerClosedCents: number | null, variableCostPerClosedCents: number | null): number | null {
  if (revenuePerClosedCents === null || variableCostPerClosedCents === null) return null;
  const margin = revenuePerClosedCents - variableCostPerClosedCents;
  if (margin <= 0) return null;
  return monthlyFixedCents / margin;
}

