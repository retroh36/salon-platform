import { describe, expect, it } from "vitest";
import { compare, dayCounts, fullness, gapsWorthFilling, rightNow, stylistLoad, stylistToday, type DayVisit } from "@/lib/dashboard";
import { fromLocal, parseTime, type BookedItem, type BookingContext } from "@/lib/scheduling";

const TZ = "America/Chicago";
const DAY = "2026-10-27"; // Tuesday
const at = (time: string) => fromLocal(DAY, parseTime(time)!, TZ)!;
const m = (time: string) => parseTime(time)!;

const CUT = { id: "cut", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false };
const COLOR = { id: "color", activeMinutes: 30, processingMinutes: 30, finishingMinutes: 30, archived: false };

function booked(id: string, svc: typeof CUT, staffId: string, time: string): BookedItem {
  return { id, appointmentId: `a-${id}`, serviceId: svc.id, staffId, resourceId: null, start: at(time), activeMinutes: svc.activeMinutes, processingMinutes: svc.processingMinutes, finishingMinutes: svc.finishingMinutes };
}

// Priya works 9-5 with a 12-1 lunch (7 hours); Ethan 9-1.
function ctx(items: BookedItem[] = []): BookingContext {
  return {
    location: { timeZone: TZ, weekly: { 2: [{ start: m("9:00"), end: m("19:00") }] } },
    services: new Map([CUT, COLOR].map((s) => [s.id, s])),
    staff: new Map([
      ["priya", { id: "priya", isActive: true, schedule: { weekly: { 2: [{ start: m("9:00"), end: m("17:00") }] }, overrides: {}, timeOff: [] }, serviceIds: new Set(["cut", "color"]) }],
      ["ethan", { id: "ethan", isActive: true, schedule: { weekly: { 2: [{ start: m("9:00"), end: m("13:00") }] }, overrides: {}, timeOff: [] }, serviceIds: new Set(["cut"]) }],
    ]),
    resources: new Map(),
    booked: items,
    blocks: [{ blockId: "lunch", date: DAY, staffId: "priya", kind: "lunch", start: at("12:00"), end: at("13:00") }],
  };
}

function visit(over: Partial<DayVisit> & Pick<DayVisit, "appointmentId" | "start">): DayVisit {
  return {
    itemId: `i-${over.appointmentId}-${over.start}`,
    staffId: "priya",
    clientId: "c",
    client: "Ava K.",
    service: "Cut",
    end: over.start + 60,
    status: "booked",
    checkedInAt: null,
    started: false,
    finished: false,
    priceCents: 5000,
    ...over,
  };
}

describe("today's counts", () => {
  it("counts visits (not services), check-ins up to a time, no-shows, cancellations and expected takings", () => {
    const visits = [
      visit({ appointmentId: "a", start: 600, status: "completed", checkedInAt: 595 }),
      visit({ appointmentId: "a", start: 660, status: "completed", checkedInAt: 595, priceCents: 3000 }),
      visit({ appointmentId: "b", start: 700, status: "checked_in", checkedInAt: 705 }),
      visit({ appointmentId: "c", start: 800, status: "no_show" }),
      visit({ appointmentId: "d", start: 900, status: "canceled" }),
      visit({ appointmentId: "e", start: 960 }),
    ];
    expect(dayCounts(visits)).toEqual({ appointments: 4, checkedIn: 2, noShows: 1, canceled: 1, expectedCents: 18000 });
    // Up to 10am, only "a" had checked in.
    expect(dayCounts(visits, 600).checkedIn).toBe(1);
    expect(compare(5, 3)).toEqual({ now: 5, then: 3, change: 2 });
  });
});

describe("how full the book is", () => {
  it("is client time over working time, less blocked time, with processing counted as free", () => {
    // Priya: 7 hours available; a cut (60) and a color (60 of her time).
    const c = ctx([booked("1", CUT, "priya", "9:00"), booked("2", COLOR, "priya", "14:00")]);
    expect(stylistLoad(c, "priya", DAY)).toEqual({ available: 420, booked: 120 });
    expect(stylistLoad(c, "ethan", DAY)).toEqual({ available: 240, booked: 0 });
    expect(fullness(c, ["priya", "ethan"], DAY)).toEqual({ available: 660, booked: 120, percent: 18 });
    // Nobody works on Sunday.
    expect(fullness(c, ["priya"], "2026-11-01").percent).toBeNull();
  });
});

describe("right now", () => {
  it("lists who's in the chair, starting within the hour, and late by 5 to 60 minutes", () => {
    const visits = [
      visit({ appointmentId: "in", start: m("9:00"), status: "checked_in", started: true }),
      visit({ appointmentId: "done", start: m("9:00"), status: "checked_in", started: true, finished: true }),
      visit({ appointmentId: "soon", start: m("10:30") }),
      visit({ appointmentId: "later", start: m("11:30") }),
      visit({ appointmentId: "late", start: m("9:50"), status: "confirmed" }),
      visit({ appointmentId: "very-late", start: m("8:30") }),
      visit({ appointmentId: "just", start: m("9:57") }),
    ];
    const now = rightNow(visits, m("10:00"));
    expect(now.inChair.map((v) => v.appointmentId)).toEqual(["in"]);
    expect(now.upNext.map((v) => v.appointmentId)).toEqual(["soon"]);
    expect(now.late.map((v) => [v.appointmentId, v.lateMinutes])).toEqual([["late", 10]]);
  });
});

describe("each stylist today", () => {
  it("shows how booked they are, who's next and what they're doing", () => {
    const c = ctx([booked("1", CUT, "priya", "9:00"), booked("2", CUT, "priya", "14:00")]);
    const visits = [
      visit({ appointmentId: "1", itemId: "1", start: m("9:00"), status: "checked_in", started: true }),
      visit({ appointmentId: "2", itemId: "2", start: m("14:00"), client: "Ben L." }),
    ];
    const at930 = stylistToday(c, visits, "priya", DAY, m("9:30"));
    expect(at930).toMatchObject({ percent: 29, visits: 2, next: { client: "Ben L.", start: m("14:00") }, status: "in_service" });
    // Still with the 9:00 client after 10: running late; a reported overrun too.
    expect(stylistToday(c, visits, "priya", DAY, m("10:15"))!.status).toBe("running_late");
    expect(stylistToday(c, visits, "priya", DAY, m("9:30"), [{ id: "d", kind: "overrun", itemId: "1", minutes: 15 }])!.status).toBe("running_late");
    const finished = visits.map((v) => (v.appointmentId === "1" ? { ...v, finished: true } : v));
    expect(stylistToday(c, finished, "priya", DAY, m("12:30"))!.status).toBe("on_break");
    expect(stylistToday(c, finished, "priya", DAY, m("11:00"))!.status).toBe("free");
    expect(stylistToday(c, finished, "priya", DAY, m("17:30"))!.status).toBe("done");
    expect(stylistToday(c, finished, "priya", DAY, m("11:00"), [{ id: "o", kind: "call_out", staffId: "priya", from: at("10:30") }])!.status).toBe("off");
    // Not working and nothing booked: not shown.
    expect(stylistToday(c, [], "priya", "2026-11-01", null)).toBeNull();
  });
});

describe("gaps worth filling", () => {
  it("finds free stretches of an hour or more from now, longest first", () => {
    const c = ctx([booked("1", CUT, "priya", "10:00"), booked("2", CUT, "ethan", "9:30")]);
    expect(gapsWorthFilling(c, ["priya", "ethan"], DAY, m("9:10"))).toEqual([
      { staffId: "priya", date: DAY, start: m("13:00"), end: m("17:00") },
      { staffId: "ethan", date: DAY, start: m("10:30"), end: m("13:00") },
      { staffId: "priya", date: DAY, start: m("11:00"), end: m("12:00") },
    ]);
  });
});
