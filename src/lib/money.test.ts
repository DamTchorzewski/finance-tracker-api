import { describe, expect, it } from "vitest";
import { addDays, chunkRange, daysBetween, todayInWarsaw } from "./dates.ts";
import { convertMinor, fromMinor, minorDigits, toMinor } from "./money.ts";

describe("money", () => {
  it("knows the minor digits of a currency", () => {
    expect(minorDigits("PLN")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
  });

  it("turns decimal strings into minor units without float errors", () => {
    expect(toMinor("86.40", "PLN")).toBe(8640);
    expect(toMinor("0.29", "PLN")).toBe(29);
    expect(toMinor("1,005", "PLN")).toBe(101);
    expect(toMinor(-12.345, "EUR")).toBe(-1235);
    expect(toMinor("1200", "JPY")).toBe(1200);
    expect(() => toMinor("abc", "PLN")).toThrow(RangeError);
  });

  it("turns minor units back into a number", () => {
    expect(fromMinor(8640, "PLN")).toBe(86.4);
  });

  it("converts through the PLN mid rates", () => {
    expect(convertMinor(10_000, { code: "EUR", mid: 4.25 }, { code: "USD", mid: 3.98 })).toBe(
      10_678,
    );
    expect(convertMinor(10_000, { code: "EUR", mid: 4.25 }, { code: "PLN", mid: 1 })).toBe(42_500);
    expect(convertMinor(500, { code: "PLN", mid: 1 }, { code: "PLN", mid: 1 })).toBe(500);
    expect(convertMinor(10_000, { code: "PLN", mid: 1 }, { code: "JPY", mid: 0.0256 })).toBe(3906);
  });
});

describe("dates", () => {
  it("adds days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts days and splits ranges into chunks", () => {
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
    expect(chunkRange("2026-01-01", "2026-01-10", 4)).toEqual([
      ["2026-01-01", "2026-01-04"],
      ["2026-01-05", "2026-01-08"],
      ["2026-01-09", "2026-01-10"],
    ]);
  });

  it("gives the day in Warsaw, not in UTC", () => {
    expect(todayInWarsaw(new Date("2026-11-21T23:30:00Z"))).toBe("2026-11-22");
    expect(todayInWarsaw(new Date("2026-07-01T21:59:00Z"))).toBe("2026-07-01");
  });
});
