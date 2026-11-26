/**
 * Calendar-date helpers for legal deadlines.
 *
 * All legal dates in this app are *calendar dates* with no time-of-day and no
 * time zone. They are represented as JS `Date` objects at 00:00:00 UTC (which
 * is exactly how Prisma returns `@db.Date` columns). Never use local-time
 * Date methods on these values.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Build a UTC calendar date. `month` is 1-12. Throws on impossible dates. */
export function calendarDate(year: number, month: number, day: number): Date {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${year}-${month}-${day}`);
  }
  return d;
}

/** Parse "YYYY-MM-DD" strictly. */
export function parseDateOnly(value: string): Date {
  const m = ISO_DATE.exec(value.trim());
  if (!m) throw new RangeError(`Expected YYYY-MM-DD, got "${value}"`);
  return calendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Format as "YYYY-MM-DD". */
export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Strip any time-of-day, keeping the UTC calendar date. */
export function toDateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Today's calendar date in the given IANA time zone (default: Nevada). */
export function todayIn(timeZone = "America/Los_Angeles", now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // en-CA formats as YYYY-MM-DD
  return parseDateOnly(parts);
}

export function addDays(date: Date, days: number): Date {
  const d = toDateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export type MonthOverflow =
  /** Jan 31 + 1 month → Feb 28/29 (common "end of month" convention). */
  | "clamp"
  /** Jan 31 + 1 month → Mar 1 (the later, more conservative date). */
  | "rollForward";

/**
 * Add calendar months. When the target month is shorter than the start day
 * (e.g. Feb 29 + 24 months, Jan 31 + 1 month) the `overflow` strategy decides.
 * Compliance code uses "rollForward" so that ambiguous deadlines always land
 * on the LATER date.
 */
export function addMonths(date: Date, months: number, overflow: MonthOverflow): Date {
  const d = toDateOnly(date);
  const totalMonths = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(totalMonths / 12);
  const monthIndex0 = totalMonths % 12;
  const day = d.getUTCDate();
  const dim = daysInMonth(year, monthIndex0);
  if (day <= dim) return new Date(Date.UTC(year, monthIndex0, day));
  return overflow === "clamp"
    ? new Date(Date.UTC(year, monthIndex0, dim))
    : new Date(Date.UTC(year, monthIndex0 + 1, 1));
}

export function addYears(date: Date, years: number, overflow: MonthOverflow): Date {
  return addMonths(date, years * 12, overflow);
}

/** Negative if a < b, 0 if same calendar date, positive if a > b. */
export function compareDates(a: Date, b: Date): number {
  return toDateOnly(a).getTime() - toDateOnly(b).getTime();
}

export function isOnOrAfter(a: Date, b: Date): boolean {
  return compareDates(a, b) >= 0;
}

export function maxDate(dates: Date[]): Date | undefined {
  return dates.reduce<Date | undefined>(
    (acc, d) => (acc === undefined || compareDates(d, acc) > 0 ? d : acc),
    undefined,
  );
}
