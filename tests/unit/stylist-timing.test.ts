import { describe, expect, it } from "vitest";
import { checkItem, fromLocal, parseTime, stretchTiming, timingFor, type BookingContext } from "@/lib/scheduling";

const TZ = "America/Chicago";
const DAY = "2026-10-27"; // Tuesday
const at = (t: string) => fromLocal(DAY, parseTime(t)!, TZ)!;
const COLOR = { id: "color", activeMinutes: 30, processingMinutes: 35, finishingMinutes: 20, archived: false };

function ctx(): BookingContext {
  const shift = { 2: [{ start: 9 * 60, end: 18 * 60 }] };
  return {
    location: { timeZone: TZ, weekly: shift },
    services: new Map([["color", COLOR]]),
    staff: new Map([
      // Bridget's own length for color: 45 + 35 + 25 = 105 minutes.
      ["bridget", { id: "bridget", isActive: true, schedule: { weekly: shift, overrides: {}, timeOff: [] }, serviceIds: new Set(["color"]), timings: new Map([["color", { activeMinutes: 45, processingMinutes: 35, finishingMinutes: 25 }]]) }],
      ["gil", { id: "gil", isActive: true, schedule: { weekly: shift, overrides: {}, timeOff: [] }, serviceIds: new Set(["color"]) }],
    ]),
    resources: new Map(),
    booked: [],
  };
}

describe("stylists' own lengths", () => {
  it("uses the stylist's length where they have one, else the menu's", () => {
    expect(timingFor(ctx(), "bridget", "color")).toEqual({ activeMinutes: 45, processingMinutes: 35, finishingMinutes: 25 });
    expect(timingFor(ctx(), "gil", "color")).toEqual({ activeMinutes: 30, processingMinutes: 35, finishingMinutes: 20 });
    expect(timingFor(ctx(), "gil", "nope")).toBeUndefined();
  });

  it("checks a booking with the stylist's length: from 4:35pm, Bridget's runs past 6pm and Gil's just fits", () => {
    expect(checkItem(ctx(), { serviceId: "color", staffId: "gil", start: at("16:35") }).valid).toBe(true);
    const bridget = checkItem(ctx(), { serviceId: "color", staffId: "bridget", start: at("16:35") });
    expect(bridget.valid).toBe(false);
    // A length given for this booking wins.
    expect(checkItem(ctx(), { serviceId: "color", staffId: "bridget", start: at("16:35"), timing: COLOR }).valid).toBe(true);
  });

  it("stretches a service to a new length, keeping the processing gap", () => {
    expect(stretchTiming(COLOR, 100)).toEqual({ activeMinutes: 30, processingMinutes: 35, finishingMinutes: 35 });
    expect(stretchTiming({ activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0 }, 72)).toEqual({ activeMinutes: 70, processingMinutes: 0, finishingMinutes: 0 });
    expect(stretchTiming(COLOR, 70)).toEqual({ activeMinutes: 30, processingMinutes: 35, finishingMinutes: 5 });
    expect(stretchTiming(COLOR, 50)).toEqual({ activeMinutes: 15, processingMinutes: 35, finishingMinutes: 0 });
    expect(stretchTiming(COLOR, 10)).toEqual({ activeMinutes: 5, processingMinutes: 35, finishingMinutes: 0 });
  });
});
