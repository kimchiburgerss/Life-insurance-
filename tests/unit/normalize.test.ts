import { describe, expect, it } from "vitest";
import { formatDateOnly } from "@/lib/dates";
import { normalizeAddress, normalizeStreetLine, normalizeZip } from "@/lib/normalize/address";
import { displayName, hasDeceasedMarker, parseOwnerName } from "@/lib/normalize/name";
import { classifyCategory, isLifeInsurer, parseAmountCell, parseDateCell } from "@/lib/normalize/values";

describe("owner names", () => {
  it("strips ESTATE OF and reads first-last", () => {
    const n = parseOwnerName("Estate of John A. Smith");
    expect(n).toMatchObject({ full: "JOHN A SMITH", first: "JOHN", middle: "A", last: "SMITH" });
    expect(n.flags).toContain("ESTATE");
    expect(hasDeceasedMarker(n)).toBe(true);
  });

  it("handles LAST FIRST M DECD (state-file layout)", () => {
    const n = parseOwnerName("SMITH JOHN A DECD");
    expect(n).toMatchObject({ first: "JOHN", middle: "A", last: "SMITH", full: "JOHN A SMITH" });
    expect(n.flags).toEqual(expect.arrayContaining(["DECEASED", "ORDER_ASSUMED"]));
  });

  it("comma means LAST, FIRST; suffix is kept separately", () => {
    const n = parseOwnerName("Smith, John Allen Jr.");
    expect(n).toMatchObject({ first: "JOHN", middle: "ALLEN", last: "SMITH", suffix: "JR", full: "JOHN ALLEN SMITH JR" });
    expect(n.flags).not.toContain("ORDER_ASSUMED");
  });

  it("explicit order setting wins over guessing", () => {
    expect(parseOwnerName("GARCIA MARIA", "LAST_FIRST")).toMatchObject({ first: "MARIA", last: "GARCIA" });
    expect(parseOwnerName("MARIA GARCIA", "FIRST_LAST")).toMatchObject({ first: "MARIA", last: "GARCIA" });
  });

  it("guesses order from common given names", () => {
    expect(parseOwnerName("MARY JOHNSON")).toMatchObject({ first: "MARY", last: "JOHNSON" });
    expect(parseOwnerName("JOHNSON MARY")).toMatchObject({ first: "MARY", last: "JOHNSON" });
  });

  it("extracts care-of and joint owners", () => {
    const c = parseOwnerName("JOHN SMITH C/O MARY JONES");
    expect(c).toMatchObject({ full: "JOHN SMITH", careOf: "MARY JONES" });
    expect(c.flags).toContain("CARE_OF");
    const j = parseOwnerName("JOHN SMITH & MARY SMITH");
    expect(j).toMatchObject({ full: "JOHN SMITH", coOwner: "MARY SMITH" });
    expect(j.flags).toContain("JOINT");
  });

  it("flags trusts, businesses and unknown owners", () => {
    expect(parseOwnerName("JOHN SMITH TTEE").flags).toContain("TRUST");
    expect(parseOwnerName("ACME PLUMBING INC").flags).toContain("BUSINESS");
    expect(parseOwnerName("UNKNOWN").flags).toEqual(["UNKNOWN"]);
    expect(parseOwnerName("").flags).toEqual(["UNKNOWN"]);
  });

  it("removes accents and punctuation", () => {
    expect(parseOwnerName("José O'Brien-Núñez", "FIRST_LAST").full).toBe("JOSE OBRIEN NUNEZ");
  });

  it("title-cases for display", () => {
    expect(displayName("JOHN A MCDONALD III")).toBe("John A McDonald III");
  });
});

describe("addresses (USPS Pub 28 style)", () => {
  it("abbreviates suffixes, directionals and units", () => {
    expect(normalizeStreetLine("123 north Main Street apt #4").line).toBe("123 N MAIN ST APT 4");
    expect(normalizeStreetLine("4500 West Sahara Avenue Suite 200").line).toBe("4500 W SAHARA AVE STE 200");
    expect(normalizeStreetLine("77 Park Place").line).toBe("77 PARK PL");
  });

  it("does not abbreviate a suffix word that IS the street name", () => {
    expect(normalizeStreetLine("10 Court Street").line).toBe("10 COURT ST");
  });

  it("standardizes PO boxes", () => {
    expect(normalizeStreetLine("P.O. Box 1234").line).toBe("PO BOX 1234");
    expect(normalizeStreetLine("Post Office Box 9").isPoBox).toBe(true);
  });

  it("parses separate columns", () => {
    const a = normalizeAddress({ kind: "parts", line1: "123 Main Street", city: "Las Vegas", state: "Nevada", zip: "89101-1234" });
    expect(a).toMatchObject({ line1: "123 MAIN ST", city: "LAS VEGAS", state: "NV", zip5: "89101", zip4: "1234" });
    expect(a.formatted).toBe("123 MAIN ST, LAS VEGAS, NV 89101-1234");
    expect(a).toMatchObject({ streetNumber: "123", streetName: "MAIN" });
  });

  it("parses single-line addresses with and without commas", () => {
    expect(normalizeAddress({ kind: "single", value: "123 Main St, Henderson, NV 89002" })).toMatchObject({
      line1: "123 MAIN ST", city: "HENDERSON", state: "NV", zip5: "89002",
    });
    expect(normalizeAddress({ kind: "single", value: "500 E FREMONT STREET NORTH LAS VEGAS NV 89030" })).toMatchObject({
      line1: "500 E FREMONT ST", city: "NORTH LAS VEGAS", state: "NV", zip5: "89030",
    });
  });

  it("restores leading zeros Excel dropped from ZIPs", () => {
    expect(normalizeZip(2134)).toEqual({ zip5: "02134", zip4: null });
    expect(normalizeZip("abc")).toEqual({ zip5: null, zip4: null });
  });
});

describe("dates with precision", () => {
  const f = (v: unknown, o?: "MDY" | "DMY") => {
    const r = parseDateCell(v, o);
    return r && `${formatDateOnly(r.date)}/${r.precision}`;
  };

  it("parses common formats", () => {
    expect(f("2023-06-15")).toBe("2023-06-15/DAY");
    expect(f("06/15/2023")).toBe("2023-06-15/DAY");
    expect(f("6/5/23")).toBe("2023-06-05/DAY");
    expect(f("20230615")).toBe("2023-06-15/DAY");
    expect(f("Jun 15, 2023")).toBe("2023-06-15/DAY");
    expect(f("15 June 2023")).toBe("2023-06-15/DAY");
    expect(f("05/06/2023", "DMY")).toBe("2023-06-05/DAY");
    expect(f(new Date(Date.UTC(2023, 5, 15)))).toBe("2023-06-15/DAY");
    expect(f(45092)).toBe("2023-06-15/DAY"); // Excel serial
  });

  it("year-only and month-only become the LAST day of the period", () => {
    expect(f("2019")).toBe("2019-12-31/YEAR");
    expect(f(2019)).toBe("2019-12-31/YEAR");
    expect(f("2020-02")).toBe("2020-02-29/MONTH");
    expect(f("02/2021")).toBe("2021-02-28/MONTH");
    expect(f("March 2022")).toBe("2022-03-31/MONTH");
  });

  it("rejects impossible or unknown values; blank is null", () => {
    expect(() => parseDateCell("02/30/2023")).toThrow();
    expect(() => parseDateCell("someday")).toThrow();
    expect(parseDateCell("")).toBeNull();
    expect(parseDateCell(null)).toBeNull();
  });
});

describe("amounts", () => {
  it("parses money", () => {
    expect(parseAmountCell("$1,234.56")).toEqual({ cents: 123456, isMinimum: false });
    expect(parseAmountCell(99.999)).toEqual({ cents: 10000, isMinimum: false });
  });

  it("keeps the lower bound of ranges and 'over' amounts", () => {
    expect(parseAmountCell("$50 - $100")).toEqual({ cents: 5000, isMinimum: true });
    expect(parseAmountCell("OVER $100")).toEqual({ cents: 10000, isMinimum: true });
    expect(parseAmountCell("$500+")).toEqual({ cents: 50000, isMinimum: true });
  });

  it("treats undisclosed and 'under' as unknown", () => {
    expect(parseAmountCell("N/D")).toEqual({ cents: null, isMinimum: false });
    expect(parseAmountCell("UNDER $50")).toEqual({ cents: null, isMinimum: false });
    expect(parseAmountCell("")).toEqual({ cents: null, isMinimum: false });
  });

  it("rejects negatives and garbage", () => {
    expect(() => parseAmountCell("(12.00)")).toThrow();
    expect(() => parseAmountCell("abc")).toThrow();
  });
});

describe("property categories", () => {
  it("maps NAUPA insurance codes", () => {
    expect(classifyCategory("IN01", "")).toBe("LIFE_INSURANCE");
    expect(classifyCategory("in 03", "")).toBe("LIFE_INSURANCE");
    expect(classifyCategory("IN04", "")).toBe("ANNUITY");
    expect(classifyCategory("IN05", "")).toBe("OTHER");
  });

  it("falls back to the description", () => {
    expect(classifyCategory("", "Death benefit due beneficiary")).toBe("LIFE_INSURANCE");
    expect(classifyCategory("X1", "Matured annuity")).toBe("ANNUITY");
    expect(classifyCategory("", "Estate distribution")).toBe("ESTATE");
    expect(classifyCategory("MS01", "Wages")).toBe("OTHER");
    expect(classifyCategory("", "")).toBe("UNKNOWN");
  });

  it("recognizes life insurers", () => {
    expect(isLifeInsurer("Silver Sage Mutual Life Insurance Co.")).toBe(true);
    expect(isLifeInsurer("THE PRUDENTIAL INSURANCE CO OF AMERICA")).toBe(true);
    expect(isLifeInsurer("Desert Bloom Credit Union")).toBe(false);
    expect(isLifeInsurer("Life Time Fitness")).toBe(false);
  });
});
