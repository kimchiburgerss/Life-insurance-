/**
 * Dates, amounts and property categories from messy spreadsheet cells.
 */
import { calendarDate } from "@/lib/dates";
import type { DatePrecision, PropertyCategory } from "@/lib/generated/prisma/enums";
import { cleanText, isBlank } from "./text";

// ─── Dates ──────────────────────────────────────────────────────────────────

export type DateOrder = "MDY" | "DMY" | "YMD";
export type ParsedDate = { date: Date; precision: DatePrecision };
export class ValueParseError extends Error {}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
};

function lastDayOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0));
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  // Two-digit years: 00–(current yy) → 2000s, otherwise 1900s.
  const currentYY = new Date().getUTCFullYear() % 100;
  return y <= currentYY ? 2000 + y : 1900 + y;
}

/** Excel serial day number (1900 date system) → calendar date. */
function fromExcelSerial(n: number): Date {
  const ms = Math.round((n - 25569) * 86_400_000);
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Parse a date cell. A year-only or month-only value becomes the LAST day of
 * that period — the conservative choice for "date delivered to the state"
 * (later delivery ⇒ longer void period and lower fee tier).
 */
export function parseDateCell(value: unknown, order: DateOrder = "MDY"): ParsedDate | null {
  if (isBlank(value)) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ValueParseError("Invalid date");
    return { date: new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())), precision: "DAY" };
  }
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 1900 && value <= 2100) {
      return { date: calendarDate(value, 12, 31), precision: "YEAR" };
    }
    if (value > 0 && value < 80_000) return { date: fromExcelSerial(value), precision: "DAY" };
    throw new ValueParseError(`Unrecognized date number ${value}`);
  }
  const s = String(value).trim().toUpperCase();
  let m: RegExpExecArray | null;

  if ((m = /^(\d{4})$/.exec(s))) return { date: calendarDate(+m[1]!, 12, 31), precision: "YEAR" };
  if ((m = /^(\d{4})[-/.](\d{1,2})$/.exec(s))) return { date: lastDayOfMonth(+m[1]!, +m[2]!), precision: "MONTH" };
  if ((m = /^(\d{1,2})[-/.](\d{4})$/.exec(s))) return { date: lastDayOfMonth(+m[2]!, +m[1]!), precision: "MONTH" };
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return { date: calendarDate(+m[1]!, +m[2]!, +m[3]!), precision: "DAY" };
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s)))
    return { date: calendarDate(+m[1]!, +m[2]!, +m[3]!), precision: "DAY" };
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?: .*)?$/.exec(s))) {
    const a = +m[1]!;
    const b = +m[2]!;
    const y = expandYear(+m[3]!);
    const [month, day] = order === "DMY" ? [b, a] : [a, b];
    return { date: calendarDate(y, month, day), precision: "DAY" };
  }
  if ((m = /^([A-Z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s)) && MONTHS[m[1]!.slice(0, 3)]) {
    return { date: calendarDate(+m[3]!, MONTHS[m[1]!.slice(0, 3)]!, +m[2]!), precision: "DAY" };
  }
  if ((m = /^(\d{1,2}) ([A-Z]{3,9})\.? (\d{4})$/.exec(s)) && MONTHS[m[2]!.slice(0, 3)]) {
    return { date: calendarDate(+m[3]!, MONTHS[m[2]!.slice(0, 3)]!, +m[1]!), precision: "DAY" };
  }
  if ((m = /^([A-Z]{3,9})\.? (\d{4})$/.exec(s)) && MONTHS[m[1]!.slice(0, 3)]) {
    return { date: lastDayOfMonth(+m[2]!, MONTHS[m[1]!.slice(0, 3)]!), precision: "MONTH" };
  }
  throw new ValueParseError(`Unrecognized date "${String(value)}"`);
}

// ─── Amounts ────────────────────────────────────────────────────────────────

export type ParsedAmount = { cents: number | null; isMinimum: boolean };

/**
 * "$1,234.56" → 123456. Ranges ("$50-$100") and "OVER $100" keep the LOWER
 * bound and mark it as a minimum, so expected value is never overstated.
 * "UNDER $50", "N/D", "UNDISCLOSED" → unknown.
 */
export function parseAmountCell(value: unknown): ParsedAmount {
  if (isBlank(value)) return { cents: null, isMinimum: false };
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new ValueParseError(`Invalid amount ${value}`);
    return { cents: Math.round(value * 100), isMinimum: false };
  }
  const s = String(value).trim().toUpperCase();
  if (/^(N\/?D|N\/?A|NONE|UNDISCLOSED|NOT DISCLOSED|UNKNOWN|-|\*+)$/.test(s)) return { cents: null, isMinimum: false };
  if (/^(UNDER|LESS THAN|<)/.test(s)) return { cents: null, isMinimum: false };
  const nums = [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
  if (nums.length === 0) throw new ValueParseError(`Unrecognized amount "${String(value)}"`);
  const isMinimum = nums.length > 1 || /^(OVER|MORE THAN|>|AT LEAST)/.test(s) || /\+$/.test(s);
  if (/^\(.*\)$/.test(s) || /^-/.test(s)) throw new ValueParseError(`Negative amount "${String(value)}"`);
  return { cents: Math.round(Math.min(...nums) * 100), isMinimum };
}

// ─── Property category ──────────────────────────────────────────────────────

/**
 * NAUPA standard property type codes. IN01–IN03: policy benefits / death
 * proceeds due beneficiaries; IN04: matured policies, endowments, annuities.
 */
const NAUPA_INSURANCE: Record<string, PropertyCategory> = {
  IN01: "LIFE_INSURANCE",
  IN02: "LIFE_INSURANCE",
  IN03: "LIFE_INSURANCE",
  IN04: "ANNUITY",
  IN05: "OTHER",
  IN06: "OTHER",
  IN07: "OTHER",
  IN08: "OTHER",
};

export function classifyCategory(code: unknown, description: unknown): PropertyCategory {
  const c = cleanText(code).replace(/ /g, "");
  if (NAUPA_INSURANCE[c]) return NAUPA_INSURANCE[c]!;
  const d = cleanText(description);
  if (/\b(ANNUIT|ENDOWMENT|MATURED POLIC)/.test(d)) return "ANNUITY";
  if (/\b(LIFE INS|LIFE POLIC|DEATH BENEFIT|DEATH CLAIM|BENEFICIAR|POLICY PROCEED|INSURANCE PROCEED)/.test(d)) return "LIFE_INSURANCE";
  if (/\b(ESTATE|PROBATE|DECEDENT|HEIR)/.test(d)) return "ESTATE";
  if (c || d) return "OTHER";
  return "UNKNOWN";
}

const LIFE_INSURER_NAMES =
  /\b(PRUDENTIAL|METLIFE|METROPOLITAN LIFE|TRANSAMERICA|JOHN HANCOCK|AFLAC|GENWORTH|BRIGHTHOUSE|MASSMUTUAL|MASSACHUSETTS MUTUAL|NORTHWESTERN MUTUAL|PENN MUTUAL|MUTUAL OF OMAHA|UNITED OF OMAHA|RIVERSOURCE|ATHENE|COREBRIDGE|EQUITABLE|VOYA|SYMETRA|SECURIAN|TRUSTAGE|CUNA MUTUAL|UNUM|AMERITAS|FIDELITY (&|AND) GUARANTY|JACKSON NATIONAL|OHIO NATIONAL|AMERICAN GENERAL|MIDLAND NATIONAL|SAMMONS|GREAT WEST|LINCOLN NATIONAL|PACIFIC LIFE|PROTECTIVE LIFE|PRINCIPAL LIFE|COLONIAL PENN|BANKERS LIFE|GLOBE LIFE|NEW YORK LIFE|GUARDIAN LIFE|MINNESOTA LIFE|KANSAS CITY LIFE|AMERICAN NATIONAL)\b/;

/** Heuristic: is the holder a life insurer / annuity company? */
export function isLifeInsurer(holderName: unknown): boolean {
  const h = cleanText(holderName);
  if (!h) return false;
  if (LIFE_INSURER_NAMES.test(h)) return true;
  return /\bLIFE\b/.test(h) && /\b(INS|INSURANCE|ASSURANCE|ASSUR|CO|COMPANY|CORP|MUTUAL|NATIONAL|ANNUITY|BENEFIT|FRATERNAL)\b/.test(h) ||
    /\b(ANNUITY|FRATERNAL BENEFIT)\b/.test(h);
}
