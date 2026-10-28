import { describe, expect, it } from "vitest";
import { canSwap, cantTake, offerableDays, shiftsOverlap, swapPartners } from "@/lib/shift-swaps";

describe("who swaps", () => {
  it("is the front desk and assistants, with someone in the same role", () => {
    const team = [
      { id: "sam", role: "front_desk" },
      { id: "jo", role: "front_desk" },
      { id: "kai", role: "front_desk", isActive: false },
      { id: "ari", role: "assistant" },
      { id: "gil", role: "stylist" },
    ];
    expect(swapPartners({ id: "sam", role: "front_desk" }, team).map((p) => p.id)).toEqual(["jo"]);
    expect(swapPartners({ id: "ari", role: "assistant" }, team)).toEqual([]);
    expect(swapPartners({ id: "gil", role: "stylist" }, team)).toEqual([]);
    expect([canSwap("front_desk"), canSwap("assistant"), canSwap("stylist"), canSwap("manager")]).toEqual([true, true, false, false]);
  });
});

describe("taking a shift", () => {
  const nineToFive = [{ start: 540, end: 1020 }];

  it("is refused when they'd be working two shifts at once", () => {
    expect(cantTake("Jo", { hours: [{ start: 960, end: 1200 }], timeOff: [] }, nineToFive, "Wed, Nov 4")).toBe("Jo is already working then on Wed, Nov 4.");
    // Back to back is fine: an evening after a day shift.
    expect(cantTake("Jo", { hours: [{ start: 1020, end: 1200 }], timeOff: [] }, nineToFive, "Wed, Nov 4")).toBeNull();
    expect(shiftsOverlap([{ start: 0, end: 60 }], [{ start: 60, end: 120 }])).toBe(false);
  });

  it("is refused through approved time off, all day or part of it", () => {
    expect(cantTake("Jo", { hours: [], timeOff: [{ startMinute: null, endMinute: null }] }, nineToFive, "Wed, Nov 4")).toBe("Jo has time off on Wed, Nov 4.");
    expect(cantTake(null, { hours: [], timeOff: [{ startMinute: 780, endMinute: 900 }] }, nineToFive, "Wed, Nov 4")).toBe("You have time off on Wed, Nov 4.");
    expect(cantTake(null, { hours: [], timeOff: [{ startMinute: 1080, endMinute: 1200 }] }, nineToFive, "Wed, Nov 4")).toBeNull();
  });

  it("offers only days with hours, from today", () => {
    const days = [
      { date: "2026-11-02", hours: nineToFive },
      { date: "2026-11-03", hours: [] },
      { date: "2026-11-04", hours: nineToFive },
    ];
    expect(offerableDays(days, "2026-11-03").map((d) => d.date)).toEqual(["2026-11-04"]);
  });
});
