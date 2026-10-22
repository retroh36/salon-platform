import { describe, expect, it } from "vitest";
import { fromLocal, parseTime, type BookedItem, type BookingContext } from "@/lib/scheduling";
import { planVisitAt, visitTimes, type VisitRequest } from "@/lib/scheduling/online";

const TZ = "America/Chicago";
const DAY = "2026-10-27"; // Tuesday
const at = (time: string, day = DAY) => fromLocal(day, parseTime(time)!, TZ)!;
const minutes = (time: string) => parseTime(time)!;
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

const CUT = { id: "cut", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false };
const BLOWOUT = { id: "blowout", activeMinutes: 45, processingMinutes: 0, finishingMinutes: 0, archived: false };
const COLOR = { id: "color", activeMinutes: 45, processingMinutes: 35, finishingMinutes: 25, archived: false };
const TRIM = { id: "trim", activeMinutes: 15, processingMinutes: 0, finishingMinutes: 0, archived: false };

const shift = (from: string, to: string) => ({ start: minutes(from), end: minutes(to) });

function ctx(booked: BookedItem[] = [], { chairs = 3, blocks = [] as BookingContext["blocks"] } = {}): BookingContext {
  return {
    location: { timeZone: TZ, weekly: { 2: [shift("9:00", "19:00")] } },
    services: new Map([CUT, BLOWOUT, COLOR, TRIM].map((s) => [s.id, s])),
    staff: new Map([
      ["bridget", { id: "bridget", isActive: true, schedule: { weekly: { 2: [shift("9:00", "13:00"), shift("14:00", "18:00")] }, overrides: {}, timeOff: [] }, serviceIds: new Set(["cut", "color", "trim"]) }],
      ["shae", { id: "shae", isActive: true, schedule: { weekly: { 2: [shift("12:00", "17:00")] }, overrides: {}, timeOff: [] }, serviceIds: new Set(["cut", "blowout", "trim"]) }],
    ]),
    resources: new Map(Array.from({ length: chairs }, (_, i) => [`chair-${i + 1}`, { id: `chair-${i + 1}`, isActive: true, kind: "chair" as const, sortOrder: i }])),
    booked,
    blocks,
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

const request = (serviceIds: string[], staffId: string | null = null): VisitRequest => ({ serviceIds, staffId, stylistIds: ["bridget", "shae"] });
const EARLY = at("0:00");
const times = (c: BookingContext, r: VisitRequest, notBefore = EARLY) => visitTimes(c, r, DAY, { notBefore }).map((t) => hhmm(t.minute));

describe("times a visit can start online", () => {
  it("offers only times inside the stylist's hours, every 15 minutes", () => {
    const found = times(ctx(), request(["cut"], "bridget"));
    expect(found[0]).toBe("9:00");
    // The last cut before lunch starts at 12:00; after lunch from 14:00 to 17:00.
    expect(found).toContain("12:00");
    expect(found).not.toContain("12:15");
    expect(found).not.toContain("13:00");
    expect(found).toContain("14:00");
    expect(found.at(-1)).toBe("17:00");
  });

  it("skips times taken by other clients, but books into a color's processing gap", () => {
    const busy = ctx([item("c", COLOR, "bridget", "10:00", "chair-1")]);
    const trims = times(busy, request(["trim"], "bridget"));
    // Busy 10:00-10:45 and 11:20-11:45; the gap 10:45-11:20 fits a 15-minute trim.
    expect(trims).not.toContain("10:00");
    expect(trims).toContain("10:45");
    expect(trims).toContain("11:00");
    expect(trims).not.toContain("11:15");
    expect(trims).not.toContain("11:30");
    expect(trims).toContain("11:45");
  });

  it("respects blocked time", () => {
    const blocked = ctx([], { blocks: [{ blockId: "lunch", date: DAY, staffId: "shae", kind: "lunch", start: at("13:00"), end: at("13:30") }] });
    const found = times(blocked, request(["trim"], "shae"));
    expect(found).toContain("12:45");
    expect(found).not.toContain("13:00");
    expect(found).not.toContain("13:15");
    expect(found).toContain("13:30");
  });

  it("needs a free chair for every service", () => {
    const full = ctx([item("x", CUT, "shae", "9:00", "chair-1")], { chairs: 1 });
    expect(times(full, request(["trim"], "bridget"))).not.toContain("9:00");
    expect(times(full, request(["trim"], "bridget"))).toContain("10:00");
  });

  it("books several services back to back with the chosen stylist", () => {
    const [color, trim] = planVisitAt(ctx(), request(["color", "trim"], "bridget"), at("9:00"))!;
    expect(color).toMatchObject({ serviceId: "color", staffId: "bridget", start: at("9:00") });
    // The trim starts when the color ends (45 + 35 + 25 minutes).
    expect(trim).toMatchObject({ serviceId: "trim", staffId: "bridget", start: at("10:45") });
    // Both need a chair; the color's is free again when it ends.
    expect(color.resourceId).toBe("chair-1");
    expect(trim.resourceId).toBe("chair-1");
    // With one chair taken until 10:00, the color goes in the other.
    const busy = ctx([item("x", TRIM, "shae", "9:45", "chair-1")], { chairs: 2 });
    expect(planVisitAt(busy, request(["color"], "bridget"), at("9:00"))![0].resourceId).toBe("chair-2");
  });

  it("with no preference, finds whoever can do each service, keeping one stylist when possible", () => {
    // Bridget doesn't do blowouts: a cut with Bridget, then a blowout with Shae.
    const mixed = planVisitAt(ctx(), request(["cut", "blowout"]), at("11:00"))!;
    expect(mixed.map((i) => i.staffId)).toEqual(["bridget", "shae"]);
    // Both cut and trim with Shae when Bridget is at lunch.
    const one = planVisitAt(ctx(), request(["cut", "trim"]), at("13:00"))!;
    expect(one.map((i) => i.staffId)).toEqual(["shae", "shae"]);
    // Nobody does blowouts in the morning.
    expect(planVisitAt(ctx(), request(["blowout"]), at("9:00"))).toBeNull();
  });

  it("respects the notice time and the booking window", () => {
    const found = visitTimes(ctx(), request(["cut"], "bridget"), DAY, { notBefore: at("11:10"), notAfter: at("15:00") }).map((t) => hhmm(t.minute));
    expect(found[0]).toBe("11:15");
    expect(found.at(-1)).toBe("15:00");
  });

  it("ignores the visit being rescheduled", () => {
    const own = ctx([item("mine", CUT, "bridget", "9:00", "chair-1")]);
    expect(times(own, request(["cut"], "bridget"))).not.toContain("9:00");
    const rescheduling = visitTimes(own, request(["cut"], "bridget"), DAY, { notBefore: EARLY, replacingAppointmentId: "a-mine" });
    expect(rescheduling.map((t) => hhmm(t.minute))).toContain("9:00");
  });

  it("offers nothing for a service no one offers, or no services", () => {
    expect(times(ctx(), request(["blowout"], "bridget"))).toEqual([]);
    expect(times(ctx(), request([]))).toEqual([]);
  });
});
