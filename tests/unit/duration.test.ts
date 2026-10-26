import { describe, expect, it } from "vitest";
import { formatDuration } from "@/lib/duration";

describe("formatDuration", () => {
  it("says minutes under an hour", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(5)).toBe("5 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(59)).toBe("59 min");
  });

  it("says whole hours as hours", () => {
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(120)).toBe("2 hr");
    expect(formatDuration(600)).toBe("10 hr");
  });

  it("says the rest as hours and minutes", () => {
    expect(formatDuration(61)).toBe("1 hr 1 min");
    expect(formatDuration(200)).toBe("3 hr 20 min");
    expect(formatDuration(285)).toBe("4 hr 45 min");
  });

  it("rounds to the minute and never goes below zero", () => {
    expect(formatDuration(44.6)).toBe("45 min");
    expect(formatDuration(59.6)).toBe("1 hr");
    expect(formatDuration(-10)).toBe("0 min");
  });
});
