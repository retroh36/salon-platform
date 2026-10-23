import { describe, expect, it } from "vitest";
import { suggestRebook, weeksUntilNext } from "@/lib/rebook";
import { formatDay } from "@/lib/schedule-format";
import { fromLocal, type BookedItem, type BookingContext, type TimeOff } from "@/lib/scheduling";

const TZ = "America/Chicago";
// Friday, October 23, 2026.
const TODAY = "2026-10-23";
const weekdays = (from: number, to: number, days = [1, 2, 3, 4, 5, 6]) => Object.fromEntries(days.map((d) => [d, [{ start: from * 60, end: to * 60 }]]));
const svc = (id: string, active: number) => ({ id, activeMinutes: active, processingMinutes: 0, finishingMinutes: 0, archived: false });

function ctx(booked: BookedItem[] = [], timeOff: TimeOff[] = []): BookingContext {
  return {
    location: { timeZone: TZ, weekly: weekdays(9, 19) },
    services: new Map([["cut", svc("cut", 45)]]),
    staff: new Map([["gil", { id: "gil", isActive: true, schedule: { weekly: weekdays(9, 18, [2, 3, 4, 5]), overrides: {}, timeOff }, serviceIds: new Set(["cut"]) }]]),
    resources: new Map(),
    booked,
    blocks: [],
  };
}
const input = { today: TODAY, clientFirstName: "Daniel", staffId: "gil", staffFirstName: "Gil", serviceIds: ["cut"], aroundMinute: 11 * 60 + 30, formatDate: formatDay };

describe("rebooking before they leave", () => {
  it("is their usual rhythm in weeks, or six", () => {
    expect(weeksUntilNext(28)).toBe(4);
    expect(weeksUntilNext(17)).toBe(2);
    expect(weeksUntilNext(null)).toBe(6);
  });

  it("suggests the same time, their rhythm from today, with their stylist", () => {
    const s = suggestRebook(ctx(), { ...input, intervalDays: 28 })!;
    expect(s).toMatchObject({ date: "2026-11-20", startMinute: 11 * 60 + 30, staffId: "gil" });
    expect(s.why).toBe("Daniel usually comes every 4 weeks with Gil.");
    expect(s.when).toBe(`${formatDay("2026-11-20")} at 11:30am`);
  });

  it("moves to the nearest free time, then a nearby day the stylist works", () => {
    const taken: BookedItem = { id: "x", appointmentId: "ax", serviceId: "cut", staffId: "gil", resourceId: null, start: fromLocal("2026-11-20", 11 * 60, TZ)!, activeMinutes: 90, processingMinutes: 0, finishingMinutes: 0 };
    expect(suggestRebook(ctx([taken]), { ...input, intervalDays: 28 })).toMatchObject({ date: "2026-11-20", startMinute: 12 * 60 + 30 });
    // Off all that week: the Tuesday after.
    const off: TimeOff[] = [{ startsOn: "2026-11-17", endsOn: "2026-11-21", status: "approved" }];
    expect(suggestRebook(ctx([], off), { ...input, intervalDays: 28 })).toMatchObject({ date: "2026-11-24", startMinute: 11 * 60 + 30 });
  });
});
