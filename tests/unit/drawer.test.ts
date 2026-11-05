import { describe, expect, it } from "vitest";
import { differenceText, expectedAt, movesBefore, type CashMove, type DrawerCount } from "@/lib/drawer";
import { formatPrice } from "@/lib/services";

const count = (id: string, kind: DrawerCount["kind"], at: string, expected = 0, counted = 0): DrawerCount => ({ id, kind, at, expectedCents: expected, countedCents: counted, by: null, note: null });
const move = (at: string, cents: number): CashMove => ({ at, amountCents: cents, saleId: "s", saleNumber: 1, by: null });

describe("the cash drawer", () => {
  const moves = [move("2026-11-05T15:00:00Z", 4500), move("2026-11-05T17:00:00Z", -1000), move("2026-11-05T19:00:00Z", 8000)];

  it("expects the opening count (or what it should have been) plus the cash so far", () => {
    expect(expectedAt(20000, null, moves, "2026-11-05T18:00:00Z")).toBe(23500);
    expect(expectedAt(20000, count("o", "open", "2026-11-05T14:00:00Z", 20000, 19500), moves, "2026-11-05T20:00:00Z")).toBe(31000);
  });

  it("lists the cash since the count before, to look into a difference", () => {
    const counts = [count("o", "open", "2026-11-05T14:00:00Z"), count("m", "mid", "2026-11-05T18:00:00Z"), count("c", "close", "2026-11-05T23:00:00Z")];
    expect(movesBefore(counts[1], counts, moves).map((m) => m.amountCents)).toEqual([4500, -1000]);
    expect(movesBefore(counts[2], counts, moves).map((m) => m.amountCents)).toEqual([8000]);
    expect(movesBefore(counts[0], counts, moves)).toEqual([]);
  });

  it("says over, short or matches", () => {
    expect(differenceText(0, formatPrice)).toBe("matches");
    expect(differenceText(-1200, formatPrice)).toBe("$12 short");
    expect(differenceText(550, formatPrice)).toBe("$5.50 over");
  });
});
