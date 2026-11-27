import { describe, expect, it } from "vitest";
import { dateInNevada, formatNevadaDate, nevadaDateOf, parseDateOnly } from "@/lib/dates";

describe("Nevada calendar dates for timestamps", () => {
  it("an evening in Nevada is still that day, although the UTC date has moved on", () => {
    // 5:30 pm on Nov 26 in Las Vegas (PST, UTC−8) = 01:30 UTC on Nov 27.
    expect(formatNevadaDate(dateInNevada(new Date("2026-11-27T01:30:00Z")))).toBe("2026-11-26");
    // Summer (PDT, UTC−7): 4:59 pm on Jul 3 = 23:59 UTC on Jul 3; 5:01 pm = 00:01 UTC on Jul 4.
    expect(formatNevadaDate(new Date("2026-07-03T23:59:00Z"))).toBe("2026-07-03");
    expect(formatNevadaDate(new Date("2026-07-04T00:01:00Z"))).toBe("2026-07-03");
  });
  it("date-only values (typed dates, stored as UTC midnight) are kept as they are", () => {
    const typed = parseDateOnly("2026-11-26");
    expect(nevadaDateOf(typed)).toEqual(typed);
    expect(formatNevadaDate(typed)).toBe("2026-11-26");
    expect(formatNevadaDate(null)).toBeUndefined();
  });
  it("the e-signature void-period check uses the Nevada day (signing at 6 pm the day before the eligible date is still void)", () => {
    const eligible = parseDateOnly("2026-11-27");
    const signedAt = new Date("2026-11-27T02:00:00Z"); // 6 pm on Nov 26 in Nevada
    expect(dateInNevada(signedAt) < eligible).toBe(true);
  });
});
