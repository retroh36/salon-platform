import { describe, expect, it } from "vitest";
import { countedAmount, isPossibleShrinkage, splitAmount, summarize } from "@/lib/stocktake";

const tube = { unit: "g" as const, size: 60, cost_cents: 950 };
const bottle = { unit: "ml" as const, size: 1000, cost_cents: 1400 };
const retail = { unit: "unit" as const, size: 1, cost_cents: 1500 };

describe("counting", () => {
  it("adds full containers and the open one", () => {
    expect(countedAmount("2", "24", tube)).toBe(144);
    expect(countedAmount("", "35.5", tube)).toBe(35.5);
    expect(countedAmount("3", "", tube)).toBe(180);
    expect(countedAmount("0", "", tube)).toBe(0);
    expect(countedAmount("", "", tube)).toBeNull();
    expect(countedAmount("1.5", "", tube)).toBeNull();
    expect(countedAmount("1", "-3", tube)).toBeNull();
    // Retail is just units.
    expect(countedAmount("7", "99", retail)).toBe(7);
  });

  it("splits a saved amount back for showing it", () => {
    expect(splitAmount(144, tube)).toEqual({ full: 2, open: 24 });
    expect(splitAmount(180, tube)).toEqual({ full: 3, open: 0 });
    expect(splitAmount(2300, bottle)).toEqual({ full: 2, open: 300 });
    expect(splitAmount(7, retail)).toEqual({ full: 7, open: 0 });
  });
});

describe("possible shrinkage", () => {
  it("flags big shortfalls by value or share, not small ones or extras", () => {
    // 2 tubes ($19) missing out of 5.
    expect(isPossibleShrinkage(300, 180, tube)).toBe(true);
    // 30 g of 600 (5%, $4.75): weighing and normal use.
    expect(isPossibleShrinkage(600, 570, tube)).toBe(false);
    // A bottle of developer: $14, but half of what's expected.
    expect(isPossibleShrinkage(2000, 1000, bottle)).toBe(true);
    // A few grams.
    expect(isPossibleShrinkage(10, 6, tube)).toBe(false);
    // One retail unit can be a miscount; two worth $30 can't.
    expect(isPossibleShrinkage(8, 7, retail)).toBe(false);
    expect(isPossibleShrinkage(8, 6, retail)).toBe(true);
    // More than expected isn't shrinkage.
    expect(isPossibleShrinkage(60, 300, tube)).toBe(false);
  });

  it("sums a stocktake", () => {
    expect(
      summarize([
        { expected: 300, counted: 180, product: tube },
        { expected: 120, counted: 180, product: tube },
        { expected: 5, counted: 5, product: retail },
      ]),
    ).toEqual({ counted: 3, changed: 2, gainCents: 950, lossCents: 1900, flagged: 1 });
  });
});
