import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  calendarDate,
  formatDateOnly,
  parseDateOnly,
  todayIn,
} from "@/lib/dates";

const d = parseDateOnly;
const f = formatDateOnly;

describe("calendar dates", () => {
  it("rejects impossible dates", () => {
    expect(() => calendarDate(2025, 2, 29)).toThrow(RangeError);
    expect(() => parseDateOnly("2025-13-01")).toThrow(RangeError);
    expect(() => parseDateOnly("03/01/2025")).toThrow(RangeError);
  });

  it("accepts Feb 29 in leap years only", () => {
    expect(f(calendarDate(2024, 2, 29))).toBe("2024-02-29");
    expect(f(calendarDate(2000, 2, 29))).toBe("2000-02-29"); // divisible by 400
    expect(() => calendarDate(1900, 2, 29)).toThrow(); // divisible by 100, not 400
  });

  it("adds days across month and year ends", () => {
    expect(f(addDays(d("2025-12-31"), 1))).toBe("2026-01-01");
    expect(f(addDays(d("2024-02-28"), 1))).toBe("2024-02-29");
    expect(f(addDays(d("2025-02-28"), 1))).toBe("2025-03-01");
  });

  it("computes today in Nevada time, not UTC", () => {
    // 2026-01-01 06:30 UTC is still 2025-12-31 in Las Vegas (UTC-8).
    expect(f(todayIn("America/Los_Angeles", new Date("2026-01-01T06:30:00Z")))).toBe("2025-12-31");
    expect(f(todayIn("America/Los_Angeles", new Date("2026-01-01T09:00:00Z")))).toBe("2026-01-01");
  });
});

describe("addMonths", () => {
  it("keeps the same day when it exists", () => {
    expect(f(addMonths(d("2024-01-15"), 24, "rollForward"))).toBe("2026-01-15");
    expect(f(addMonths(d("2024-12-15"), 1, "clamp"))).toBe("2025-01-15");
  });

  it("handles month-end overflow with both strategies", () => {
    expect(f(addMonths(d("2025-01-31"), 1, "clamp"))).toBe("2025-02-28");
    expect(f(addMonths(d("2025-01-31"), 1, "rollForward"))).toBe("2025-03-01");
    expect(f(addMonths(d("2024-01-31"), 1, "clamp"))).toBe("2024-02-29");
    expect(f(addMonths(d("2025-03-31"), 1, "rollForward"))).toBe("2025-05-01");
    expect(f(addMonths(d("2025-12-31"), 2, "rollForward"))).toBe("2026-03-01");
  });

  it("handles Feb 29 + 24 months (target year not a leap year)", () => {
    expect(f(addMonths(d("2024-02-29"), 24, "clamp"))).toBe("2026-02-28");
    expect(f(addMonths(d("2024-02-29"), 24, "rollForward"))).toBe("2026-03-01");
  });

  it("handles Feb 29 + 48 months (target year is a leap year)", () => {
    expect(f(addMonths(d("2024-02-29"), 48, "rollForward"))).toBe("2028-02-29");
  });

  it("supports negative months", () => {
    expect(f(addMonths(d("2026-03-31"), -1, "clamp"))).toBe("2026-02-28");
  });
});
