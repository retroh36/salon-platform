import { describe, expect, it } from "vitest";
import { CATEGORY_PALETTE, categoryColors, gridRange, hourMarks, layoutColumn, offHours } from "@/lib/calendar";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const span = (start: number, end: number) => ({ start, end });

describe("category colors", () => {
  it("gives each category its own color, in alphabetical order", () => {
    const colors = categoryColors(["Cuts", "Color", "Balayage", "Cuts"]);
    expect([...colors.keys()]).toEqual(["Balayage", "Color", "Cuts"]);
    expect([...colors.values()]).toEqual(CATEGORY_PALETTE.slice(0, 3));
  });

  it("doesn't depend on the order categories arrive in", () => {
    expect(categoryColors(["Cuts", "Color"])).toEqual(categoryColors(["Color", "Cuts"]));
  });

  it("repeats colors after the palette runs out", () => {
    const many = Array.from({ length: CATEGORY_PALETTE.length + 1 }, (_, i) => `Category ${String.fromCharCode(65 + i)}`);
    const colors = categoryColors(many);
    expect(colors.get(many.at(-1)!)).toBe(CATEGORY_PALETTE[0]);
  });
});

describe("grid range", () => {
  it("uses the day's opening hours", () => {
    expect(gridRange([span(h(9), h(19))], [span(h(8), h(20))], [])).toEqual(span(h(9), h(19)));
  });

  it("falls back when the salon is closed", () => {
    expect(gridRange([], [span(h(8), h(20))], [])).toEqual(span(h(8), h(20)));
    expect(gridRange([], [], [])).toEqual(span(h(9), h(17)));
  });

  it("stretches to whole hours around appointments outside opening hours", () => {
    expect(gridRange([span(h(9), h(17))], [], [span(h(8, 30), h(9, 15)), span(h(16), h(17, 20))])).toEqual(span(h(8), h(18)));
  });

  it("never goes past midnight", () => {
    expect(gridRange([span(h(9), h(23, 30))], [], [])).toEqual(span(h(9), h(24)));
  });
});

describe("off hours", () => {
  it("is the range minus bookable time", () => {
    expect(offHours(span(h(9), h(19)), [span(h(9), h(13)), span(h(14), h(18))])).toEqual([span(h(13), h(14)), span(h(18), h(19))]);
    expect(offHours(span(h(9), h(19)), [])).toEqual([span(h(9), h(19))]);
  });
});

describe("hour marks", () => {
  it("labels each whole hour in the range", () => {
    expect(hourMarks(span(h(9), h(12)))).toEqual([h(9), h(10), h(11)]);
    expect(hourMarks(span(h(8, 30), h(10)))).toEqual([h(9)]);
  });
});

describe("column layout", () => {
  it("keeps separate blocks flush", () => {
    expect(layoutColumn([span(h(10), h(11)), span(h(11), h(12))]).map((b) => b.depth)).toEqual([0, 0]);
  });

  it("indents a block booked inside another", () => {
    // Color 10:00-11:45 with a cut in its processing gap at 10:45.
    const laid = layoutColumn([span(h(10, 45), h(11, 15)), span(h(10), h(11, 45))]);
    expect(laid.map((b) => [b.start, b.depth])).toEqual([
      [h(10), 0],
      [h(10, 45), 1],
    ]);
  });

  it("reuses an indent once it's free", () => {
    const laid = layoutColumn([span(h(10), h(13)), span(h(10, 30), h(11)), span(h(11, 30), h(12))]);
    expect(laid.map((b) => b.depth)).toEqual([0, 1, 1]);
  });

  it("stacks three overlapping blocks", () => {
    const laid = layoutColumn([span(h(10), h(12)), span(h(10), h(11)), span(h(10, 30), h(11))]);
    expect(laid.map((b) => [b.end, b.depth])).toEqual([
      [h(12), 0],
      [h(11), 1],
      [h(11), 2],
    ]);
  });

  it("keeps the blocks' own fields", () => {
    expect(layoutColumn([{ ...span(h(10), h(11)), id: "a" }])[0]).toEqual({ start: h(10), end: h(11), id: "a", depth: 0 });
  });
});
