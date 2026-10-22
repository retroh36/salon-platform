import { describe, expect, it } from "vitest";
import { checkGroup, fromLocal, parseTime, staggered, type BookingContext } from "@/lib/scheduling";

const TZ = "America/Chicago";
const DAY = "2026-11-10";
const weekdays = (from: number, to: number) => Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: from * 60, end: to * 60 }]]));
const stylist = (id: string) => ({ id, isActive: true, schedule: { weekly: weekdays(9, 18), overrides: {}, timeOff: [] }, serviceIds: new Set(["updo"]) });
const ctx: BookingContext = {
  location: { timeZone: TZ, weekly: weekdays(9, 19) },
  services: new Map([["updo", { id: "updo", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false }]]),
  staff: new Map(["ana", "ben", "cy"].map((id) => [id, stylist(id)])),
  resources: new Map([
    ["chair-1", { id: "chair-1", isActive: true, kind: "chair" as const, sortOrder: 1 }],
    ["chair-2", { id: "chair-2", isActive: true, kind: "chair" as const, sortOrder: 2 }],
  ]),
  booked: [{ id: "x", appointmentId: "a-x", serviceId: "updo", staffId: "cy", resourceId: null, start: fromLocal(DAY, parseTime("10:00")!, TZ)!, activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0 }],
};
const guest = (staffId: string, start: number, resource = "any") => [{ serviceId: "updo", staffId, startMinute: start, resource }];

describe("group bookings", () => {
  it("staggers guests' start times", () => {
    expect(staggered(600, 4, 0)).toEqual([600, 600, 600, 600]);
    expect(staggered(600, 3, 30)).toEqual([600, 630, 660]);
  });

  it("checks guests together: one stylist and one chair each at a time", () => {
    expect(checkGroup(ctx, [guest("ana", 600), guest("ben", 600)], DAY).ok).toBe(true);
    // Two guests with Ana at once.
    expect(checkGroup(ctx, [guest("ana", 600), guest("ana", 630, "none")], DAY).problems).toEqual([[[]], [[{ code: "staff_double_booked", conflictWith: undefined }]]]);
    // Cy already has a client; and only two chairs for three guests.
    const three = checkGroup(ctx, [guest("ana", 540), guest("ben", 540), guest("cy", 570)], DAY);
    expect(three.problems.map((g) => g[0].map((p) => p.code))).toEqual([[], [], ["no_free_resource", "staff_double_booked"]]);
  });
});
