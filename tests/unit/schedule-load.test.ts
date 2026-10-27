import { describe, expect, it } from "vitest";
import { toWeekly } from "@/lib/scheduling/load";

describe("toWeekly", () => {
  it("puts each day's shifts earliest first, whatever order the rows came in", () => {
    const weekly = toWeekly([
      { weekday: 2, start_minute: 840, end_minute: 1080 },
      { weekday: 3, start_minute: 540, end_minute: 1080 },
      { weekday: 2, start_minute: 540, end_minute: 780 },
    ]);
    expect(weekly[2]).toEqual([
      { start: 540, end: 780 },
      { start: 840, end: 1080 },
    ]);
    expect(weekly[3]).toEqual([{ start: 540, end: 1080 }]);
    expect(weekly[1]).toBeUndefined();
  });
});
