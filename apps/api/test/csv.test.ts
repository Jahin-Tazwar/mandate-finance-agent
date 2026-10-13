import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney } from "../src/store/csv";

describe("parseMoney", () => {
  it("turns spreadsheet amounts into integer cents", () => {
    expect(parseMoney("12.34")).toBe(1234);
    expect(parseMoney("-42.18")).toBe(-4218);
    expect(parseMoney("2400")).toBe(240000);
    expect(parseMoney("0.5")).toBe(50);
    expect(parseMoney("-0.05")).toBe(-5);
  });

  it("is exact where floating point isn't", () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in cents it's exact
    expect(parseMoney("0.10") + parseMoney("0.20")).toBe(parseMoney("0.30"));
  });

  it.each(["$12.34", "1,200.00", "12.345", "abc", "", "12.34 USD"])("rejects %j", (bad) => {
    expect(() => parseMoney(bad)).toThrow(/plain amount/);
  });
});

describe("formatMoney", () => {
  it("round-trips with parseMoney", () => {
    for (const cents of [0, 5, -5, 1234, -4218, 240000]) {
      expect(parseMoney(formatMoney(cents))).toBe(cents);
    }
  });
});
