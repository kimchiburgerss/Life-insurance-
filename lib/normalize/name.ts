/**
 * Owner-name normalization for unclaimed-property records.
 *
 * Handles what states typically publish: "ESTATE OF JOHN A SMITH",
 * "SMITH JOHN A DECD", "SMITH, JOHN A JR", "JOHN SMITH C/O MARY JONES",
 * "JOHN & MARY SMITH", "SMITH FAMILY TRUST", "ACME INC", "UNKNOWN".
 */
import { cleanText } from "./text";

export type NameOrder = "AUTO" | "LAST_FIRST" | "FIRST_LAST";

export type NameFlag =
  | "ESTATE" // "ESTATE OF …" / "… EST"
  | "DECEASED" // "DECD", "DECEASED"
  | "CARE_OF" // "C/O …" (another person receives mail)
  | "TRUST" // trust / trustee / custodian / POD
  | "JOINT" // two owners ("&", "AND", "OR")
  | "BUSINESS" // organization, not a person
  | "UNKNOWN" // no usable name
  | "ORDER_ASSUMED"; // single-field name whose order we had to guess

export type ParsedName = {
  /** Display form: FIRST MIDDLE LAST SUFFIX (uppercase). */
  full: string;
  first: string | null;
  middle: string | null;
  last: string | null;
  suffix: string | null;
  flags: NameFlag[];
  careOf: string | null;
  /** Second owner on a joint record, if any (raw, cleaned). */
  coOwner: string | null;
  /** Name tokens without suffixes/titles, for matching. */
  tokens: string[];
};

const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "ESQ", "MD", "PHD", "DDS", "CPA"]);
const TITLES = new Set(["MR", "MRS", "MS", "MISS", "DR", "REV", "SIR"]);
const ESTATE_PREFIX = /^(THE )?(ESTATE OF|EST OF|ESTATE|EST) /;
const ESTATE_SUFFIX = / (ESTATE|EST)$/;
const DECEASED = / ?\b(DECD|DECEASED|DEC D|DCSD|DECSD)\b ?/g;
const CARE_OF = / (C O|C\/O|CARE OF|ATTN|ATTENTION) (.+)$/;
const TRUST_WORDS = /\b(TRUST|TRUSTEE|TTEE|TTEES|TR|TRS|REVOCABLE|LIVING TRUST|FBO|UTMA|UGMA|CUST|CUSTODIAN|POD|ITF|JTWROS|JT TEN|TOD)\b/;
const BUSINESS_WORDS =
  /\b(INC|LLC|L L C|CORP|CORPORATION|COMPANY|CO INC|LTD|LP|LLP|PLLC|BANK|ASSN|ASSOCIATION|CHURCH|MINISTRIES|DEPT|DEPARTMENT|UNIVERSITY|COLLEGE|SCHOOL|HOSPITAL|CLINIC|SERVICES|SERVICE|ENTERPRISES|HOLDINGS|PARTNERS|GROUP|FOUNDATION|CASINO|HOTEL|RESORT|MOTORS|RESTAURANT|INSURANCE|AGENCY|COUNTY|CITY OF|STATE OF)\b/;
const UNKNOWN_NAMES = /^(UNKNOWN|UNKNOWN OWNER|OWNER UNKNOWN|NOT AVAILABLE|NA|N A|NONE|NAME NOT PROVIDED|UNIDENTIFIED|NO NAME)?$/;
const JOINT_SPLIT = / (&|AND|OR) /;

// Small given-name lexicon used only to guess order in single-field names.
const COMMON_GIVEN = new Set(
  (
    "JAMES JOHN ROBERT MICHAEL WILLIAM DAVID RICHARD JOSEPH THOMAS CHARLES CHRISTOPHER DANIEL MATTHEW ANTHONY MARK " +
    "DONALD STEVEN PAUL ANDREW JOSHUA KENNETH KEVIN BRIAN GEORGE TIMOTHY RONALD EDWARD JASON JEFFREY RYAN JACOB GARY " +
    "NICHOLAS ERIC JONATHAN STEPHEN LARRY JUSTIN SCOTT BRANDON BENJAMIN SAMUEL FRANK GREGORY RAYMOND ALEXANDER PATRICK " +
    "JACK DENNIS JERRY TYLER AARON JOSE HENRY ADAM DOUGLAS NATHAN PETER ZACHARY KYLE WALTER HAROLD JEREMY ETHAN CARL " +
    "KEITH ROGER GERALD CHRISTIAN TERRY SEAN ARTHUR AUSTIN NOAH LAWRENCE JESSE JOE BRYAN BILLY JORDAN ALBERT DYLAN " +
    "BRUCE WILLIE GABRIEL ALAN JUAN LOGAN WAYNE RALPH ROY EUGENE RANDY VINCENT RUSSELL LOUIS PHILIP BOBBY JOHNNY " +
    "MARY PATRICIA JENNIFER LINDA ELIZABETH BARBARA SUSAN JESSICA SARAH KAREN LISA NANCY BETTY MARGARET SANDRA ASHLEY " +
    "KIMBERLY EMILY DONNA MICHELLE CAROL AMANDA DOROTHY MELISSA DEBORAH STEPHANIE REBECCA SHARON LAURA CYNTHIA KATHLEEN " +
    "AMY ANGELA SHIRLEY ANNA BRENDA PAMELA EMMA NICOLE HELEN SAMANTHA KATHERINE CHRISTINE DEBRA RACHEL CAROLYN JANET " +
    "CATHERINE MARIA HEATHER DIANE RUTH JULIE OLIVIA JOYCE VIRGINIA VICTORIA KELLY LAUREN CHRISTINA JOAN EVELYN JUDITH " +
    "MEGAN ANDREA CHERYL HANNAH JACQUELINE MARTHA GLORIA TERESA ANN SARA MADISON FRANCES KATHRYN JANICE JEAN ABIGAIL " +
    "ALICE JUDY SOPHIA GRACE DENISE AMBER DORIS MARILYN DANIELLE BEVERLY ISABELLA THERESA DIANA NATALIE BRITTANY " +
    "CHARLOTTE MARIE KAYLA ALEXIS LORI ROSE IRENE CARMEN PEGGY BETH JANE"
  ).split(" "),
);

function stripTitles(tokens: string[]): string[] {
  return tokens.filter((t, i) => !(i === 0 && TITLES.has(t)));
}

function splitSuffix(tokens: string[]): { tokens: string[]; suffix: string | null } {
  const idx = tokens.findIndex((t) => SUFFIXES.has(t));
  if (idx === -1) return { tokens, suffix: null };
  return { tokens: tokens.filter((_, i) => i !== idx), suffix: tokens[idx]! };
}

function assignParts(tokens: string[], order: "LAST_FIRST" | "FIRST_LAST") {
  if (tokens.length === 0) return { first: null, middle: null, last: null };
  if (tokens.length === 1) return { first: null, middle: null, last: tokens[0]! };
  if (order === "LAST_FIRST") {
    const [last, first, ...rest] = tokens;
    return { first: first!, middle: rest.length ? rest.join(" ") : null, last: last! };
  }
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  const middle = tokens.slice(1, -1);
  return { first, middle: middle.length ? middle.join(" ") : null, last };
}

function guessOrder(tokens: string[]): { order: "LAST_FIRST" | "FIRST_LAST"; assumed: boolean } {
  if (tokens.length < 2) return { order: "FIRST_LAST", assumed: false };
  const firstIsGiven = COMMON_GIVEN.has(tokens[0]!);
  const secondIsGiven = COMMON_GIVEN.has(tokens[1]!);
  const lastIsInitial = tokens[tokens.length - 1]!.length === 1;
  // "SMITH JOHN A": a trailing middle initial is the classic LAST FIRST M layout.
  if (lastIsInitial && !firstIsGiven) return { order: "LAST_FIRST", assumed: true };
  if (secondIsGiven && !firstIsGiven) return { order: "LAST_FIRST", assumed: true };
  if (firstIsGiven && !secondIsGiven) return { order: "FIRST_LAST", assumed: true };
  return { order: "FIRST_LAST", assumed: true };
}

export function parseOwnerName(raw: unknown, order: NameOrder = "AUTO"): ParsedName {
  const flags = new Set<NameFlag>();
  let s = cleanText(raw, "&/");
  let careOf: string | null = null;
  let coOwner: string | null = null;

  const care = CARE_OF.exec(` ${s}`);
  if (care) {
    careOf = care[2]!.trim();
    s = ` ${s}`.slice(0, care.index).trim();
    flags.add("CARE_OF");
  }
  s = s.replace(/\//g, " ").replace(/\s+/g, " ").trim();

  let explicitFirstLast = false;
  if (ESTATE_PREFIX.test(s)) {
    flags.add("ESTATE");
    s = s.replace(ESTATE_PREFIX, "");
    explicitFirstLast = true; // "ESTATE OF JOHN SMITH" is written first-last
  }
  if (ESTATE_SUFFIX.test(s)) {
    flags.add("ESTATE");
    s = s.replace(ESTATE_SUFFIX, "");
  }
  if (DECEASED.test(s)) {
    flags.add("DECEASED");
    s = s.replace(DECEASED, " ").replace(/\s+/g, " ").trim();
  }

  if (UNKNOWN_NAMES.test(s)) {
    flags.add("UNKNOWN");
    return { full: "", first: null, middle: null, last: null, suffix: null, flags: [...flags], careOf, coOwner, tokens: [] };
  }
  if (BUSINESS_WORDS.test(s) && !TRUST_WORDS.test(s)) flags.add("BUSINESS");
  if (TRUST_WORDS.test(s)) {
    flags.add("TRUST");
    s = s.replace(new RegExp(TRUST_WORDS.source, "g"), " ").replace(/\b(THE|FAMILY|OF)\b/g, " ").replace(/\s+/g, " ").trim();
  }

  const joint = JOINT_SPLIT.exec(s);
  if (joint) {
    flags.add("JOINT");
    coOwner = s.slice(joint.index + joint[0].length).trim() || null;
    s = s.slice(0, joint.index).trim();
  }
  s = s.replace(/&/g, " ").trim();

  if (flags.has("BUSINESS")) {
    const tokens = s.split(" ").filter(Boolean);
    return { full: s, first: null, middle: null, last: null, suffix: null, flags: [...flags], careOf, coOwner, tokens };
  }

  // Comma means "LAST, FIRST MIDDLE" regardless of the batch setting.
  let resolved: "LAST_FIRST" | "FIRST_LAST";
  const rawStr = String(raw ?? "");
  const hasComma = /,/.test(rawStr.replace(/\b(JR|SR|II|III|IV)\b\.?,?/gi, ""));
  let tokens = stripTitles(s.split(" ").filter(Boolean));
  const split = splitSuffix(tokens);
  tokens = split.tokens;

  if (hasComma) resolved = "LAST_FIRST";
  else if (explicitFirstLast) resolved = "FIRST_LAST";
  else if (order !== "AUTO") resolved = order;
  else {
    const guess = guessOrder(tokens);
    resolved = guess.order;
    if (guess.assumed) flags.add("ORDER_ASSUMED");
  }

  const parts = assignParts(tokens, resolved);
  const full = [parts.first, parts.middle, parts.last, split.suffix].filter(Boolean).join(" ");
  return { full, ...parts, suffix: split.suffix, flags: [...flags], careOf, coOwner, tokens };
}

/** True when the record itself says the owner has died. */
export function hasDeceasedMarker(name: ParsedName): boolean {
  return name.flags.includes("ESTATE") || name.flags.includes("DECEASED");
}

/** Title-case for display ("JOHN A SMITH JR" → "John A Smith Jr"). */
export function displayName(upper: string): string {
  return upper
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c: string) => `Mc${c.toUpperCase()}`);
}
