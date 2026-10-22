import { describe, expect, it } from "vitest";
import { freeTime, fromLocal, matchOpening, openingAround, parseTime, walkInQueue, nextFree, type BookedItem, type BookingContext, type WaitlistEntry } from "@/lib/scheduling";

const TZ = "America/Chicago";
const DAY = "2026-11-10";
const at = (time: string, date = DAY) => fromLocal(date, parseTime(time)!, TZ)!;
const m = (time: string) => parseTime(time)!;
const svc = (id: string, active: number, processing = 0, finishing = 0) => ({ id, activeMinutes: active, processingMinutes: processing, finishingMinutes: finishing, archived: false });
const weekdays = (from: number, to: number) => Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: from * 60, end: to * 60 }]]));

function ctx(booked: BookedItem[] = []): BookingContext {
  return {
    location: { timeZone: TZ, weekly: weekdays(9, 19) },
    services: new Map([
      ["cut", svc("cut", 60)],
      ["color", svc("color", 30, 30, 30)],
      ["gloss", svc("gloss", 30)],
    ]),
    staff: new Map([
      ["marcus", { id: "marcus", isActive: true, schedule: { weekly: weekdays(9, 18), overrides: {}, timeOff: [] }, serviceIds: new Set(["cut", "color", "gloss"]) }],
      ["ethan", { id: "ethan", isActive: true, schedule: { weekly: weekdays(9, 17), overrides: {}, timeOff: [] }, serviceIds: new Set(["cut"]) }],
    ]),
    resources: new Map(),
    booked,
    blocks: [{ blockId: "lunch", date: DAY, staffId: "marcus", kind: "lunch", start: at("12:00"), end: at("12:30") }],
  };
}
const item = (id: string, staffId: string, time: string, minutes = 60): BookedItem => ({ id, appointmentId: `a-${id}`, serviceId: "cut", staffId, resourceId: null, start: at(time), activeMinutes: minutes, processingMinutes: 0, finishingMinutes: 0 });
const entry = (id: string, more: Partial<WaitlistEntry> = {}): WaitlistEntry => ({ id, clientId: `c-${id}`, serviceIds: ["cut"], staffIds: [], fromDate: "2026-11-01", toDate: "2026-11-30", windows: [], createdAt: new Date(`2026-10-0${id.length}T12:00:00Z`), ...more });

describe("free time and openings", () => {
  // Marcus: clients 9-12 and 15:30-18, lunch 12-12:30. A 1:00-3:30 visit was canceled.
  const busy = ctx([item("a", "marcus", "9:00", 180), item("b", "marcus", "15:30", 150)]);

  it("is working hours minus clients and blocked time", () => {
    expect(freeTime(busy, "marcus", DAY)).toEqual([{ start: m("12:30"), end: m("15:30") }]);
  });

  it("finds the gap a canceled visit leaves, from now on", () => {
    expect(openingAround(busy, "marcus", DAY, { start: m("13:00"), end: m("14:30") })).toEqual({ staffId: "marcus", date: DAY, start: m("12:30"), end: m("15:30") });
    expect(openingAround(busy, "marcus", DAY, { start: m("13:00"), end: m("14:30") }, m("13:02"))).toMatchObject({ start: m("13:05") });
    // Too little left to offer.
    expect(openingAround(busy, "marcus", DAY, { start: m("13:00"), end: m("14:30") }, m("15:10"))).toBeNull();
  });
});

describe("matching the waitlist to an opening", () => {
  const busy = ctx([item("a", "marcus", "9:00", 180), item("b", "marcus", "15:30", 150)]);
  const opening = { staffId: "marcus", date: DAY, start: m("12:30"), end: m("15:30") };

  it("fits clients by date, stylist, services and time of day, those who asked for the stylist first", () => {
    const entries = [
      entry("anyone"),
      entry("wants-marcus", { staffIds: ["marcus"] }),
      entry("wants-ethan", { staffIds: ["ethan"] }),
      entry("december", { fromDate: "2026-12-01", toDate: "2026-12-31" }),
      entry("mornings", { windows: ["morning"] }),
      entry("afternoon-color", { serviceIds: ["color", "gloss"], windows: ["afternoon"] }),
      entry("too-long", { serviceIds: ["color", "color", "cut"] }),
    ];
    const matches = matchOpening(busy, opening, entries);
    expect(matches.map((x) => [x.entryId, x.start, x.end])).toEqual([
      ["wants-marcus", m("12:30"), m("13:30")],
      ["anyone", m("12:30"), m("13:30")],
      ["afternoon-color", m("12:30"), m("14:30")],
    ]);
    expect(matches[2].lines.map((l) => [l.serviceId, l.startMinute])).toEqual([
      ["color", m("12:30")],
      ["gloss", m("14:00")],
    ]);
  });
});

describe("walk-ins", () => {
  it("go to the next free stylist who does the service, each after those ahead", () => {
    // Marcus is free from 12:30; Ethan has someone until 11.
    const c = ctx([item("a", "marcus", "9:00", 180), item("e", "ethan", "9:00", 120)]);
    expect(nextFree(c, "cut", DAY, m("10:02"))).toMatchObject({ staffId: "ethan", start: m("11:00") });
    expect(nextFree(c, "color", DAY, m("10:02"))).toMatchObject({ staffId: "marcus", start: m("12:30") });
    const queue = walkInQueue(c, [{ id: "1", serviceId: "cut" }, { id: "2", serviceId: "cut" }, { id: "3", serviceId: "gloss" }], DAY, m("10:02"));
    expect(queue.map((q) => (q.staffId ? [q.id, q.staffId, q.start, q.wait] : [q.id, null]))).toEqual([
      ["1", "ethan", m("11:00"), 58],
      ["2", "ethan", m("12:00"), 118],
      ["3", "marcus", m("12:30"), 148],
    ]);
  });
});
