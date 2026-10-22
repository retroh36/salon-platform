import { describe, expect, it } from "vitest";
import { alternativesFor, checkVisitOn, fromLocal, MAX_VISITS, parseTime, planSeries, seriesDates, visitsInScope, type BookedItem, type BookingContext, type VisitLine } from "@/lib/scheduling";

const TZ = "America/Chicago";
const at = (date: string, time: string) => fromLocal(date, parseTime(time)!, TZ)!;
const CUT = { id: "cut", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false };
const weekdays = (from: number, to: number) => Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: from * 60, end: to * 60 }]]));

function ctx(booked: BookedItem[] = []): BookingContext {
  return {
    location: { timeZone: TZ, weekly: weekdays(9, 19) },
    services: new Map([["cut", CUT]]),
    staff: new Map([
      ["priya", { id: "priya", isActive: true, schedule: { weekly: weekdays(9, 18), overrides: {}, timeOff: [] }, serviceIds: new Set(["cut"]) }],
      ["ethan", { id: "ethan", isActive: true, schedule: { weekly: weekdays(9, 17), overrides: {}, timeOff: [] }, serviceIds: new Set(["cut"]) }],
    ]),
    resources: new Map([["chair-1", { id: "chair-1", isActive: true, kind: "chair" as const, sortOrder: 1 }]]),
    booked,
  };
}
const cut = (id: string, staffId: string, date: string, time: string): BookedItem => ({ id, appointmentId: `a-${id}`, serviceId: "cut", staffId, resourceId: null, start: at(date, time), activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0 });
const LINES: VisitLine[] = [{ serviceId: "cut", staffId: "priya", startMinute: 11 * 60, resource: "none" }];

describe("series dates", () => {
  it("repeats every few weeks, for a number of visits or until a date", () => {
    expect(seriesDates("2026-10-27", 2, { kind: "count", count: 4 })).toEqual(["2026-10-27", "2026-11-10", "2026-11-24", "2026-12-08"]);
    expect(seriesDates("2026-10-27", 4, { kind: "until", until: "2027-01-19" })).toEqual(["2026-10-27", "2026-11-24", "2026-12-22", "2027-01-19"]);
    expect(seriesDates("2026-10-27", 1, { kind: "until", until: "2030-01-01" })).toHaveLength(MAX_VISITS);
  });
});

describe("checking a series", () => {
  it("checks each visit on its own date, with a free chair when wanted", () => {
    const c = ctx([cut("x", "priya", "2026-11-10", "11:30")]);
    expect(checkVisitOn(c, LINES, "2026-10-27")).toEqual({ ok: true, problems: [[]], resources: [null] });
    expect(checkVisitOn(c, LINES, "2026-11-10").problems).toEqual([[{ code: "staff_double_booked", conflictWith: "x" }]]);
    expect(checkVisitOn(c, [{ ...LINES[0], resource: "any" }], "2026-10-27").resources).toEqual(["chair-1"]);
  });

  it("suggests the nearest time that day, then another stylist, then a nearby day", () => {
    // Priya's taken 11-12:30 on Nov 10: she's free from 10 (an hour
    // earlier, nearer than 12:30), and Ethan is free at 11.
    const c = ctx([cut("x", "priya", "2026-11-10", "11:00"), cut("y", "priya", "2026-11-10", "11:30")]);
    const alts = alternativesFor(c, LINES, "2026-11-10");
    expect(alts.map((a) => [a.kind, a.date, a.lines[0].staffId, a.lines[0].startMinute, a.shift])).toEqual([
      ["time", "2026-11-10", "priya", 10 * 60, -60],
      ["stylist", "2026-11-10", "ethan", 11 * 60, 0],
    ]);
  });

  it("falls back to a nearby day when the day is full", () => {
    // Nov 10: Priya and Ethan booked all day.
    const full = ["priya", "ethan"].flatMap((s) => Array.from({ length: 9 }, (_, i) => cut(`${s}${i}`, s, "2026-11-10", `${9 + i}:00`)));
    const alts = alternativesFor(ctx(full), LINES, "2026-11-10");
    expect(alts.map((a) => [a.kind, a.date])).toEqual([["day", "2026-11-11"]]);
  });

  it("plans each date with alternatives only where needed", () => {
    const c = ctx([cut("x", "priya", "2026-11-10", "11:30")]);
    const plan = planSeries(c, LINES, ["2026-10-27", "2026-11-10"]);
    expect(plan.map((p) => [p.date, p.check.ok, p.alternatives.length > 0])).toEqual([
      ["2026-10-27", true, false],
      ["2026-11-10", false, true],
    ]);
  });
});

describe("which visits a change is for", () => {
  const visits = [1, 2, 3, 4].map((index) => ({ index, editable: index !== 2 }));
  it("is this one, this and following, or all, skipping ones that can't change", () => {
    expect(visitsInScope(visits, 3, "this").map((v) => v.index)).toEqual([3]);
    expect(visitsInScope(visits, 1, "following").map((v) => v.index)).toEqual([1, 3, 4]);
    expect(visitsInScope(visits, 3, "following").map((v) => v.index)).toEqual([3, 4]);
    expect(visitsInScope(visits, 3, "all").map((v) => v.index)).toEqual([1, 3, 4]);
  });
});
