import { describe, expect, it } from "vitest";
import { findOpenings, fromLocal, parseTime, type BookedItem, type BookingContext } from "@/lib/scheduling";
import { findOpenings as direct } from "@/lib/scheduling/openings";

const TZ = "America/Chicago";
const DAY = "2026-10-27"; // Tuesday
const at = (time: string) => fromLocal(DAY, parseTime(time)!, TZ)!;
const minutes = (time: string) => parseTime(time)!;

const CUT = { id: "cut", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false };
const TRIM = { id: "trim", activeMinutes: 15, processingMinutes: 0, finishingMinutes: 0, archived: false };
const COLOR = { id: "color", activeMinutes: 45, processingMinutes: 35, finishingMinutes: 25, archived: false };
const OLD = { id: "old", activeMinutes: 30, processingMinutes: 0, finishingMinutes: 0, archived: true };

function ctx(booked: BookedItem[] = [], chairs = 2): BookingContext {
  return {
    location: { timeZone: TZ, weekly: { 2: [{ start: minutes("9:00"), end: minutes("19:00") }] } },
    services: new Map([CUT, TRIM, COLOR, OLD].map((s) => [s.id, s])),
    staff: new Map([
      ["priya", { id: "priya", isActive: true, schedule: { weekly: { 2: [{ start: minutes("9:00"), end: minutes("13:00") }, { start: minutes("14:00"), end: minutes("18:00") }] }, overrides: {}, timeOff: [] }, serviceIds: new Set(["cut", "trim", "color", "old"]) }],
      ["ethan", { id: "ethan", isActive: true, schedule: { weekly: { 2: [{ start: minutes("9:00"), end: minutes("17:00") }] }, overrides: {}, timeOff: [] }, serviceIds: new Set(["cut", "trim"]) }],
      ["gone", { id: "gone", isActive: false, schedule: { weekly: { 2: [{ start: 0, end: 1440 }] }, overrides: {}, timeOff: [] }, serviceIds: new Set(["cut"]) }],
    ]),
    resources: new Map(Array.from({ length: chairs }, (_, i) => [`chair-${i + 1}`, { id: `chair-${i + 1}`, isActive: true, kind: "chair" as const, sortOrder: i }])),
    booked,
  };
}

const item = (id: string, svc: typeof CUT, staffId: string, time: string, resourceId: string | null = null): BookedItem => ({
  id,
  appointmentId: `a-${id}`,
  serviceId: svc.id,
  staffId,
  resourceId,
  start: at(time),
  activeMinutes: svc.activeMinutes,
  processingMinutes: svc.processingMinutes,
  finishingMinutes: svc.finishingMinutes,
});

const label = (o: { staffId: string; startMinute: number }) => `${o.staffId} ${Math.floor(o.startMinute / 60)}:${String(o.startMinute % 60).padStart(2, "0")}`;

describe("free times for a service", () => {
  it("lists everyone who does it, earliest first, with a free chair", () => {
    expect(direct).toBe(findOpenings);
    const found = findOpenings(ctx(), { serviceId: "cut", date: DAY, limit: 4 });
    expect(found.map(label)).toEqual(["priya 9:00", "ethan 9:00", "priya 9:15", "ethan 9:15"]);
    expect(found[0]).toMatchObject({ start: at("9:00"), resourceId: "chair-1" });
  });

  it("respects hours, breaks, other clients and the window", () => {
    // Priya has a 2pm client and a 1-2 break. From noon:
    const found = findOpenings(ctx([item("b", CUT, "priya", "14:00")]), { serviceId: "cut", date: DAY, staffIds: ["priya"], from: minutes("12:00"), to: minutes("16:00") });
    // 12:00 ends at 1 (fine); 12:15+ runs into the break; 2-3 is taken.
    expect(found.map(label)).toEqual(["priya 12:00", "priya 15:00", "priya 15:15", "priya 15:30", "priya 15:45", "priya 16:00"]);
  });

  it("uses processing gaps", () => {
    const found = findOpenings(ctx([item("c", COLOR, "priya", "10:00")]), { serviceId: "trim", date: DAY, staffIds: ["priya"], from: minutes("10:00"), to: minutes("11:30"), step: 5 });
    // Free 10:45-11:20 while the color processes, then after 11:45.
    expect(found.map(label)).toContain("priya 10:45");
    expect(found.map(label)).toContain("priya 11:05");
    expect(found.map(label)).not.toContain("priya 11:10");
  });

  it("needs a free chair, skips the past, archived services and inactive staff", () => {
    const full = ctx([item("x", CUT, "ethan", "9:00", "chair-1")], 1);
    expect(findOpenings(full, { serviceId: "cut", date: DAY, to: minutes("9:30") }).map(label)).toEqual([]);
    expect(findOpenings(ctx(), { serviceId: "cut", date: DAY, notBefore: at("15:50"), limit: 2 }).map(label)).toEqual(["priya 16:00", "ethan 16:00"]);
    expect(findOpenings(ctx(), { serviceId: "old", date: DAY })).toEqual([]);
    expect(findOpenings(ctx(), { serviceId: "cut", date: DAY, limit: 50 }).some((o) => o.staffId === "gone")).toBe(false);
  });

  it("checks each stylist with their own length when given one", () => {
    // Priya has a client at 2pm. With the menu's hour, 12:00 fits before
    // her 1pm break; with her usual 80 minutes it doesn't, and 11:40 does.
    const usual = new Map([["priya", { activeMinutes: 80, processingMinutes: 0, finishingMinutes: 0 }]]);
    const q = { serviceId: "cut", date: DAY, staffIds: ["priya"], from: minutes("11:30"), to: minutes("12:00"), step: 5 };
    expect(findOpenings(ctx(), q).map(label)).toContain("priya 12:00");
    const found = findOpenings(ctx(), { ...q, timings: usual });
    expect(found.map(label)).toEqual(["priya 11:30", "priya 11:35", "priya 11:40"]);
    expect(found[0].minutes).toBe(80);
    // Others keep the menu's length.
    expect(findOpenings(ctx(), { serviceId: "cut", date: DAY, staffIds: ["ethan"], limit: 1, timings: usual })[0].minutes).toBe(60);
  });
});
