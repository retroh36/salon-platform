import { describe, expect, it } from "vitest";
import { checkItem, fromLocal, itemSegments, parseTime, stretchTiming, timingFor, type BookedItem, type BookingContext, type BookingService, type BookingStaff } from "@/lib/scheduling";
import { fitSteps, parseSteps, stepsProblem, stepsTiming, type Step } from "@/lib/scheduling/steps";

const CHICAGO = "America/Chicago";
const TUESDAY = "2026-10-27";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const at = (time: string) => fromLocal(TUESDAY, parseTime(time)!, CHICAGO)!;
const busy = (name: string, minutes: number): Step => ({ name, minutes, processing: false });
const wait = (minutes: number): Step => ({ name: "Processing", minutes, processing: true });

// Highlight 60, processing 30, gloss 15, processing 20, cut 45: 170 minutes,
// the stylist free twice.
const STEPS = [busy("Highlight", 60), wait(30), busy("Gloss", 15), wait(20), busy("Cut", 45)];
const COLOR_CUT: BookingService = { id: "color-cut", archived: false, ...stepsTiming(STEPS), steps: STEPS };
const CUT: BookingService = { id: "cut", archived: false, activeMinutes: 30, processingMinutes: 0, finishingMinutes: 0 };
const GLOSS: BookingService = { id: "gloss", archived: false, activeMinutes: 15, processingMinutes: 0, finishingMinutes: 0 };

const nina: BookingStaff = {
  id: "nina",
  isActive: true,
  schedule: { weekly: { 2: [{ start: h(9), end: h(18) }] }, overrides: {}, timeOff: [] },
  serviceIds: new Set(["color-cut", "cut", "gloss"]),
};

function context(booked: BookedItem[] = [], staff: BookingStaff = nina): BookingContext {
  return {
    location: { timeZone: CHICAGO, weekly: { 2: [{ start: h(9), end: h(19) }] } },
    services: new Map([COLOR_CUT, CUT, GLOSS].map((s) => [s.id, s])),
    staff: new Map([[staff.id, staff]]),
    resources: new Map(),
    booked,
  };
}

const colorCutAt10 = (): BookedItem => {
  const check = checkItem(context(), { serviceId: "color-cut", staffId: "nina", start: at("10:00") });
  if (!check.valid) throw new Error("should book");
  return { ...check.item, id: "cc", appointmentId: "appt-cc" };
};

describe("steps", () => {
  it("set the three totals: before the first processing step, processing, after", () => {
    expect(stepsTiming(STEPS)).toEqual({ activeMinutes: 60, processingMinutes: 50, finishingMinutes: 60 });
    expect(stepsTiming([busy("Wash", 10), busy("Cut", 30)])).toEqual({ activeMinutes: 40, processingMinutes: 0, finishingMinutes: 0 });
  });

  it("start and end with the stylist, 2 to 12 named steps in 5-minute steps", () => {
    expect(stepsProblem(STEPS)).toBeNull();
    expect(stepsProblem([busy("Cut", 30)])).toBe("count");
    expect(stepsProblem([busy("Cut", 30), wait(10)])).toBe("first_or_last");
    expect(stepsProblem([busy("Cut", 30), wait(10), wait(10), busy("Dry", 10)])).toBe("processing_twice");
    expect(stepsProblem([busy(" ", 30), busy("Dry", 10)])).toBe("name");
    expect(stepsProblem([busy("Cut", 32), busy("Dry", 10)])).toBe("minutes");
  });

  it("fit a stylist's own totals: active on the step before processing, processing on the last gap, finishing on the last step", () => {
    expect(fitSteps(STEPS, stepsTiming(STEPS))).toEqual(STEPS);
    expect(fitSteps(STEPS, { activeMinutes: 75, processingMinutes: 40, finishingMinutes: 70 })).toEqual([busy("Highlight", 75), wait(30), busy("Gloss", 15), wait(10), busy("Cut", 55)]);
    // The last gap gone: dropped, the totals still hold.
    expect(fitSteps(STEPS, { activeMinutes: 60, processingMinutes: 30, finishingMinutes: 60 })).toEqual([busy("Highlight", 60), wait(30), busy("Gloss", 15), busy("Cut", 45)]);
    // Can't be met without a step under 5 minutes: none.
    expect(fitSteps(STEPS, { activeMinutes: 60, processingMinutes: 50, finishingMinutes: 5 })).toBeNull();
    expect(fitSteps(null, { activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0 })).toBeNull();
  });

  it("are read back from the database field by field", () => {
    expect(parseSteps(STEPS)).toEqual(STEPS);
    expect(parseSteps([{ name: "Cut", minutes: "30", processing: false }])).toBeNull();
    expect(parseSteps(null)).toBeNull();
  });
});

describe("booking a service built from steps", () => {
  it("takes the service's steps and draws a segment for each", () => {
    const item = colorCutAt10();
    expect(item.steps).toEqual(STEPS);
    expect(itemSegments(item).map((s) => [s.kind, s.name, s.end.getTime() - s.start.getTime()])).toEqual([
      ["active", "Highlight", 60 * 60_000],
      ["processing", "Processing", 30 * 60_000],
      ["finishing", "Gloss", 15 * 60_000],
      ["processing", "Processing", 20 * 60_000],
      ["finishing", "Cut", 45 * 60_000],
    ]);
  });

  it("leaves both processing gaps free for other clients, and only them", () => {
    const ctx = context([colorCutAt10()]);
    // First gap 11:00–11:30, second 11:45–12:05.
    expect(checkItem(ctx, { serviceId: "cut", staffId: "nina", start: at("11:00") }).valid).toBe(true);
    expect(checkItem(ctx, { serviceId: "gloss", staffId: "nina", start: at("11:45") }).valid).toBe(true);
    expect(checkItem(ctx, { serviceId: "gloss", staffId: "nina", start: at("11:35") }).valid).toBe(false);
    expect(checkItem(ctx, { serviceId: "cut", staffId: "nina", start: at("11:45") }).valid).toBe(false);
  });

  it("fits the steps to a stylist's own length, and to a booking made longer", () => {
    const slower = { ...nina, timings: new Map([["color-cut", { activeMinutes: 75, processingMinutes: 50, finishingMinutes: 60 }]]) };
    const ctx = context([], slower);
    expect(timingFor(ctx, "nina", "color-cut")!.steps![0]).toEqual(busy("Highlight", 75));
    const longer = checkItem(ctx, { serviceId: "color-cut", staffId: "nina", start: at("10:00"), timing: stretchTiming(timingFor(ctx, "nina", "color-cut")!, 200) });
    expect(longer.valid && longer.item.steps!.at(-1)).toEqual(busy("Cut", 60));
  });

  it("keeps a visit's own steps when it's moved", () => {
    const own = [busy("Highlight", 60), wait(45), busy("Cut", 45)];
    const moved = checkItem(context(), { id: "cc", serviceId: "color-cut", staffId: "nina", start: at("13:00"), timing: { ...stepsTiming(own), steps: own } });
    expect(moved.valid && moved.item.steps).toEqual(own);
  });
});
