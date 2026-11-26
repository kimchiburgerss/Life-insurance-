/**
 * USPS Publication 28–style address normalization (the common cases):
 * street suffixes, directionals, secondary units, PO boxes, state names, ZIPs.
 * It standardizes for matching and display; it does not validate deliverability
 * (that needs a CASS-certified service, planned with the mail adapter).
 */
import { cleanText, isBlank } from "./text";

const SUFFIX: Record<string, string> = {
  ALLEY: "ALY", ALLEE: "ALY", ALLY: "ALY", AVENUE: "AVE", AV: "AVE", AVEN: "AVE", AVENU: "AVE", AVN: "AVE", AVNUE: "AVE",
  BOULEVARD: "BLVD", BOUL: "BLVD", BOULV: "BLVD", BEND: "BND", BLUFF: "BLF", BRANCH: "BR", BRIDGE: "BRG", BYPASS: "BYP",
  CANYON: "CYN", CANYN: "CYN", CENTER: "CTR", CENTRE: "CTR", CEN: "CTR", CIRCLE: "CIR", CIRC: "CIR", CIRCL: "CIR", CRCL: "CIR",
  CLIFF: "CLF", CLUB: "CLB", COMMON: "CMN", CORNER: "COR", COURT: "CT", CRT: "CT", COVE: "CV", CREEK: "CRK", CRESCENT: "CRES",
  CROSSING: "XING", CRSSNG: "XING", DALE: "DL", DRIVE: "DR", DRIV: "DR", DRV: "DR", ESTATE: "EST", ESTATES: "ESTS",
  EXPRESSWAY: "EXPY", EXPRESS: "EXPY", EXTENSION: "EXT", FALLS: "FLS", FIELD: "FLD", FIELDS: "FLDS", FLAT: "FLT",
  FOREST: "FRST", FORK: "FRK", FREEWAY: "FWY", FRWY: "FWY", GARDEN: "GDN", GARDENS: "GDNS", GATEWAY: "GTWY", GLEN: "GLN",
  GREEN: "GRN", GROVE: "GRV", HARBOR: "HBR", HAVEN: "HVN", HEIGHTS: "HTS", HT: "HTS", HIGHWAY: "HWY", HIWAY: "HWY", HIWY: "HWY",
  HILL: "HL", HILLS: "HLS", HOLLOW: "HOLW", ISLAND: "IS", JUNCTION: "JCT", KNOLL: "KNL", LAKE: "LK", LAKES: "LKS",
  LANDING: "LNDG", LANE: "LN", LOOP: "LOOP", MANOR: "MNR", MEADOW: "MDW", MEADOWS: "MDWS", MESA: "MESA", MILL: "ML",
  MOUNT: "MT", MOUNTAIN: "MTN", MTIN: "MTN", ORCHARD: "ORCH", OVAL: "OVAL", PARK: "PARK", PARKWAY: "PKWY", PARKWY: "PKWY",
  PKY: "PKWY", PASS: "PASS", PATH: "PATH", PIKE: "PIKE", PINES: "PNES", PLACE: "PL", PLAZA: "PLZ", PLZA: "PLZ", POINT: "PT",
  POINTE: "PT", PORT: "PRT", PRAIRIE: "PR", RANCH: "RNCH", RIDGE: "RDG", RIVER: "RIV", ROAD: "RD", ROUTE: "RTE", ROW: "ROW",
  RUN: "RUN", SHORE: "SHR", SHORES: "SHRS", SKYWAY: "SKWY", SPRING: "SPG", SPRINGS: "SPGS", SQUARE: "SQ", SQR: "SQ",
  STATION: "STA", STREET: "ST", STR: "ST", STRT: "ST", SUMMIT: "SMT", TERRACE: "TER", TERR: "TER", TRACE: "TRCE",
  TRAIL: "TRL", TRAILS: "TRL", TR: "TRL", TURNPIKE: "TPKE", VALLEY: "VLY", VIEW: "VW", VILLAGE: "VLG", VILLAGES: "VLGS",
  VISTA: "VIS", VIST: "VIS", WALK: "WALK", WAY: "WAY", WY: "WAY", WELLS: "WLS",
};

const DIRECTIONAL: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};

const UNIT: Record<string, string> = {
  APARTMENT: "APT", APT: "APT", SUITE: "STE", STE: "STE", UNIT: "UNIT", BUILDING: "BLDG", BLDG: "BLDG", FLOOR: "FL",
  FL: "FL", ROOM: "RM", RM: "RM", SPACE: "SPC", SPC: "SPC", TRAILER: "TRLR", TRLR: "TRLR", LOT: "LOT", DEPARTMENT: "DEPT",
  NUMBER: "#", NO: "#",
};

export const US_STATES: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA", COLORADO: "CO", CONNECTICUT: "CT",
  DELAWARE: "DE", "DISTRICT OF COLUMBIA": "DC", FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL",
  INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE",
  NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA",
  WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY", "PUERTO RICO": "PR", GUAM: "GU",
  "VIRGIN ISLANDS": "VI", "AMERICAN SAMOA": "AS", "NORTHERN MARIANA ISLANDS": "MP",
};
const STATE_CODES = new Set(Object.values(US_STATES).concat(["AA", "AE", "AP"]));

/** Nevada cities, longest first, to split city off a single-line address. */
const NV_CITIES = [
  "NORTH LAS VEGAS", "BOULDER CITY", "CARSON CITY", "SPRING CREEK", "INCLINE VILLAGE", "SPANISH SPRINGS",
  "SUN VALLEY", "LAS VEGAS", "HENDERSON", "RENO", "SPARKS", "ELKO", "MESQUITE", "PAHRUMP", "FERNLEY", "FALLON",
  "WINNEMUCCA", "MINDEN", "GARDNERVILLE", "DAYTON", "LAUGHLIN", "WEST WENDOVER", "ELY", "YERINGTON", "LOVELOCK",
  "BATTLE MOUNTAIN", "CALIENTE", "TONOPAH", "HAWTHORNE", "STATELINE", "ZEPHYR COVE", "MOAPA", "OVERTON",
].sort((a, b) => b.length - a.length);

export type NormalizedAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip5: string | null;
  zip4: string | null;
  isPoBox: boolean;
  /** USPS-style single line: "123 N MAIN ST APT 4, LAS VEGAS, NV 89101". */
  formatted: string | null;
  /** House number and street-name tokens (without suffix/unit), for matching. */
  streetNumber: string | null;
  streetName: string | null;
};

const EMPTY: NormalizedAddress = {
  line1: null, line2: null, city: null, state: null, zip5: null, zip4: null, isPoBox: false,
  formatted: null, streetNumber: null, streetName: null,
};

export function normalizeState(value: unknown): string | null {
  const s = cleanText(value);
  if (!s) return null;
  if (STATE_CODES.has(s)) return s;
  return US_STATES[s] ?? null;
}

export function normalizeZip(value: unknown): { zip5: string | null; zip4: string | null } {
  if (isBlank(value)) return { zip5: null, zip4: null };
  const digits = String(value).replace(/[^0-9]/g, "");
  if (digits.length === 9) return { zip5: digits.slice(0, 5), zip4: digits.slice(5) };
  if (digits.length === 5) return { zip5: digits, zip4: null };
  // Spreadsheets drop leading zeros (e.g. 02134 → 2134).
  if (digits.length === 4 || digits.length === 3) return { zip5: digits.padStart(5, "0"), zip4: null };
  if (digits.length === 8) return { zip5: digits.slice(0, 4).padStart(5, "0"), zip4: digits.slice(4) };
  return { zip5: null, zip4: null };
}

/** Standardize a street line: "123 north Main Street apt #4" → "123 N MAIN ST APT 4". */
export function normalizeStreetLine(value: unknown): {
  line: string | null;
  isPoBox: boolean;
  streetNumber: string | null;
  streetName: string | null;
} {
  let s = cleanText(value, "#-/");
  if (!s) return { line: null, isPoBox: false, streetNumber: null, streetName: null };
  s = s
    .replace(/\bP\s?O\s?(BOX|BX|B)\b/g, "PO BOX")
    .replace(/\bPOST OFFICE (BOX|BX)\b/g, "PO BOX")
    .replace(/\bPOB\b/g, "PO BOX")
    .replace(/#\s*/g, "# ")
    .replace(/\s+/g, " ")
    .trim();
  const isPoBox = /\bPO BOX\b/.test(s);
  if (isPoBox) {
    const m = /PO BOX ([A-Z0-9-]+)/.exec(s);
    return { line: m ? `PO BOX ${m[1]}` : "PO BOX", isPoBox, streetNumber: null, streetName: m ? `PO BOX ${m[1]}` : null };
  }

  const tokens = s.split(" ");
  const out: string[] = [];
  let unitStarted = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (unitStarted) {
      out.push(t === "#" ? "" : t);
      continue;
    }
    if (UNIT[t] && i > 0 && i < tokens.length - 1) {
      out.push(UNIT[t]!);
      if (tokens[i + 1] === "#") i++; // "APT # 5" → "APT 5"
      unitStarted = true;
      continue;
    }
    if (t === "#" && i > 0) {
      out.push("#");
      unitStarted = true;
      continue;
    }
    const nonNumeric = tokens.filter((x) => !/^\d/.test(x)).length;
    if (DIRECTIONAL[t] && nonNumeric > 2) {
      out.push(DIRECTIONAL[t]!);
      continue;
    }
    // A suffix word is only abbreviated after the street name, not as the name itself.
    const isLastStreetWord = i === tokens.length - 1 || Boolean(UNIT[tokens[i + 1]!]) || tokens[i + 1] === "#" || Boolean(DIRECTIONAL[tokens[i + 1]!]);
    if (SUFFIX[t] && isLastStreetWord && out.filter((x) => !/^\d/.test(x)).length > 0) {
      out.push(SUFFIX[t]!);
      continue;
    }
    out.push(t);
  }
  const line = out.filter((x) => x !== "").join(" ").replace(/\s+/g, " ").trim();
  const numMatch = /^(\d+[A-Z]?(?:-\d+)?)\s+(.*)$/.exec(line);
  const rest = numMatch ? numMatch[2]! : line;
  const streetName = rest
    .split(/ (?:APT|STE|UNIT|BLDG|FL|RM|SPC|TRLR|LOT|#)\b/)[0]!
    .split(" ")
    .filter((w) => !Object.values(SUFFIX).includes(w) && !Object.values(DIRECTIONAL).includes(w))
    .join(" ") || null;
  return { line, isPoBox, streetNumber: numMatch ? numMatch[1]! : null, streetName };
}

export type AddressInput =
  | { kind: "parts"; line1?: unknown; line2?: unknown; city?: unknown; state?: unknown; zip?: unknown }
  | { kind: "single"; value: unknown };

/** Normalize either separate columns or a single-line address. */
export function normalizeAddress(input: AddressInput): NormalizedAddress {
  if (input.kind === "parts") {
    const street = normalizeStreetLine(input.line1);
    const line2 = normalizeStreetLine(input.line2).line;
    const city = cleanText(input.city) || null;
    const state = normalizeState(input.state);
    const { zip5, zip4 } = normalizeZip(input.zip);
    return finish({ ...EMPTY, line1: street.line, line2, city, state, zip5, zip4, isPoBox: street.isPoBox, streetNumber: street.streetNumber, streetName: street.streetName });
  }
  return parseSingleLine(input.value);
}

function parseSingleLine(value: unknown): NormalizedAddress {
  const raw = String(value ?? "").trim();
  if (!raw) return { ...EMPTY };
  // "123 Main St, Las Vegas, NV 89101" — commas make this easy.
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  let zip: { zip5: string | null; zip4: string | null } = { zip5: null, zip4: null };
  let state: string | null = null;
  let city: string | null = null;

  let tail = cleanText(parts.length > 1 ? parts.slice(1).join(" ") : raw, "-");
  const zipMatch = /\b(\d{5})(?:[ -]?(\d{4}))?$/.exec(tail);
  if (zipMatch) {
    zip = { zip5: zipMatch[1]!, zip4: zipMatch[2] ?? null };
    tail = tail.slice(0, zipMatch.index).trim();
  }
  const stateMatch = /\b([A-Z]{2})$/.exec(tail);
  if (stateMatch && STATE_CODES.has(stateMatch[1]!)) {
    state = stateMatch[1]!;
    tail = tail.slice(0, stateMatch.index).trim();
  } else {
    const full = Object.keys(US_STATES).find((name) => tail.endsWith(` ${name}`) || tail === name);
    if (full) {
      state = US_STATES[full]!;
      tail = tail.slice(0, tail.length - full.length).trim();
    }
  }

  let streetPart: string;
  if (parts.length > 1) {
    streetPart = parts[0]!;
    city = tail || null;
  } else {
    const nvCity = NV_CITIES.find((c) => tail.endsWith(` ${c}`));
    if (nvCity) {
      city = nvCity;
      streetPart = tail.slice(0, tail.length - nvCity.length).trim();
    } else {
      streetPart = tail;
    }
  }
  const street = normalizeStreetLine(streetPart);
  return finish({ ...EMPTY, line1: street.line, city, state, ...zip, isPoBox: street.isPoBox, streetNumber: street.streetNumber, streetName: street.streetName });
}

function finish(a: NormalizedAddress): NormalizedAddress {
  const cityLine = [a.city, [a.state, a.zip5 ? (a.zip4 ? `${a.zip5}-${a.zip4}` : a.zip5) : null].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const formatted = [a.line1, a.line2].filter(Boolean).join(" ") + (cityLine ? `${a.line1 || a.line2 ? ", " : ""}${cityLine}` : "");
  return { ...a, formatted: formatted || null };
}

export function hasUsableAddress(a: NormalizedAddress | null | undefined): boolean {
  return Boolean(a && (a.line1 || a.zip5));
}
