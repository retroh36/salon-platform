import { describe, expect, it } from "vitest";
import {
  checkAppointment,
  checkItem,
  checkMoves,
  describeProblem,
  fromLocal,
  itemEnd,
  itemSegments,
  parseTime,
  pickResource,
  type BookedItem,
  type BookingContext,
  type BookingProblem,
  type BookingService,
  type BookingStaff,
  type ItemRequest,
  type StaffSchedule,
} from "@/lib/scheduling";

const CHICAGO = "America/Chicago";
const TUESDAY = "2026-10-27";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const span = (from: number, to: number) => ({ start: from, end: to });

function at(time: string, date = TUESDAY): Date {
  const instant = fromLocal(date, parseTime(time)!, CHICAGO);
  if (!instant) throw new Error(`${date} ${time} doesn't exist`);
  return instant;
}

// Menu: a cut (stylist busy throughout), a color with a processing gap, a
// gloss with a short gap, and a treatment that ends in processing.
const service = (id: string, active: number, processing = 0, finishing = 0, archived = false): BookingService => ({
  id,
  activeMinutes: active,
  processingMinutes: processing,
  finishingMinutes: finishing,
  archived,
});
const CUT = service("cut", 60);
const MENS_CUT = service("mens-cut", 30);
const BANG_TRIM = service("bang-trim", 15);
const COLOR = service("color", 45, 35, 25); // 105 minutes; stylist free for 35 in the middle
const GLOSS = service("gloss", 15, 20, 15);
const MASK = service("mask", 10, 20); // ends while processing
const PERM = service("perm", 45, 30, 30, true);

// Priya works a split shift (9-1, 2-6) on Tuesdays; Ethan works 9-5.
const weekly = (intervals: { start: number; end: number }[]): StaffSchedule["weekly"] => ({ 2: intervals, 3: intervals });
const priya: BookingStaff = {
  id: "priya",
  isActive: true,
  schedule: { weekly: weekly([span(h(9), h(13)), span(h(14), h(18))]), overrides: {}, timeOff: [] },
  serviceIds: new Set(["cut", "color", "gloss", "mask", "bang-trim", "mens-cut", "perm"]),
};
const ethan: BookingStaff = {
  id: "ethan",
  isActive: true,
  schedule: { weekly: weekly([span(h(9), h(17))]), overrides: {}, timeOff: [] },
  serviceIds: new Set(["cut", "mens-cut", "bang-trim", "gloss"]),
};

function context(overrides: Partial<BookingContext> = {}, extraStaff: BookingStaff[] = []): BookingContext {
  return {
    location: { timeZone: CHICAGO, weekly: { 2: [span(h(9), h(19))], 3: [span(h(9), h(19))] } },
    services: new Map([CUT, MENS_CUT, BANG_TRIM, COLOR, GLOSS, MASK, PERM].map((s) => [s.id, s])),
    staff: new Map([priya, ethan, ...extraStaff].map((s) => [s.id, s])),
    resources: new Map([
      ["chair-2", { id: "chair-2", isActive: true, kind: "chair" as const, sortOrder: 2 }],
      ["chair-1", { id: "chair-1", isActive: true, kind: "chair" as const, sortOrder: 1 }],
      ["broken-chair", { id: "broken-chair", isActive: false, kind: "chair" as const, sortOrder: 0 }],
      ["room", { id: "room", isActive: true, kind: "room" as const, sortOrder: 0 }],
    ]),
    booked: [],
    ...overrides,
  };
}

// An item already on the calendar.
function booked(id: string, svc: BookingService, staffId: string, time: string, resourceId: string | null = null, appointmentId = `appt-${id}`): BookedItem {
  return {
    id,
    appointmentId,
    serviceId: svc.id,
    staffId,
    resourceId,
    start: at(time),
    activeMinutes: svc.activeMinutes,
    processingMinutes: svc.processingMinutes,
    finishingMinutes: svc.finishingMinutes,
  };
}

const request = (serviceId: string, staffId: string, time: string, resourceId: string | null = null, date = TUESDAY): ItemRequest => ({
  serviceId,
  staffId,
  resourceId,
  start: at(time, date),
});

function problems(ctx: BookingContext, req: ItemRequest, also: BookedItem[] = []): BookingProblem[] {
  const result = checkItem(ctx, req, also);
  return result.valid ? [] : result.problems;
}

function codes(ctx: BookingContext, req: ItemRequest, also: BookedItem[] = []) {
  return problems(ctx, req, also).map((p) => p.code);
}

// ---------------------------------------------------------------------------

describe("item timing", () => {
  it("splits an item into busy, processing and finishing parts", () => {
    const item = booked("a", COLOR, "priya", "10:00");
    expect(itemSegments(item).map((s) => [s.kind, s.start.toISOString(), s.end.toISOString()])).toEqual([
      ["active", at("10:00").toISOString(), at("10:45").toISOString()],
      ["processing", at("10:45").toISOString(), at("11:20").toISOString()],
      ["finishing", at("11:20").toISOString(), at("11:45").toISOString()],
    ]);
    expect(itemEnd(item)).toEqual(at("11:45"));
  });

  it("leaves out empty parts", () => {
    expect(itemSegments(booked("a", CUT, "priya", "10:00")).map((s) => s.kind)).toEqual(["active"]);
    expect(itemSegments(booked("a", MASK, "priya", "10:00")).map((s) => s.kind)).toEqual(["active", "processing"]);
  });
});

describe("a valid booking", () => {
  it("is accepted with the service's timing", () => {
    const result = checkItem(context(), request("color", "priya", "09:00", "chair-1"));
    expect(result).toEqual({
      valid: true,
      item: {
        id: undefined,
        serviceId: "color",
        staffId: "priya",
        resourceId: "chair-1",
        start: at("09:00"),
        activeMinutes: 45,
        processingMinutes: 35,
        finishingMinutes: 25,
      },
    });
  });

  it("doesn't need a resource", () => {
    expect(checkItem(context(), request("cut", "ethan", "09:00")).valid).toBe(true);
  });
});

describe("service and stylist", () => {
  it("rejects a service the stylist doesn't offer", () => {
    expect(codes(context(), request("color", "ethan", "10:00"))).toEqual(["service_not_offered"]);
  });

  it("rejects unknown and archived services", () => {
    expect(codes(context(), request("nope", "priya", "10:00"))).toEqual(["unknown_service"]);
    expect(codes(context(), request("perm", "priya", "10:00"))).toEqual(["service_archived"]);
  });

  it("rejects unknown and inactive staff", () => {
    expect(codes(context(), request("cut", "nobody", "10:00"))).toEqual(["unknown_staff"]);
    const gone: BookingStaff = { ...ethan, id: "gone", isActive: false };
    expect(codes(context({}, [gone]), request("cut", "gone", "10:00"))).toEqual(["staff_inactive"]);
  });

  it("only allows starts on a 5-minute mark", () => {
    expect(codes(context(), request("cut", "ethan", "10:07"))).toEqual(["invalid_start"]);
    expect(codes(context(), { ...request("cut", "ethan", "10:05"), start: new Date(at("10:05").getTime() + 30_000) })).toEqual([
      "invalid_start",
    ]);
    expect(codes(context(), request("cut", "ethan", "10:05"))).toEqual([]);
  });
});

describe("stylist hours", () => {
  it("uses the availability rules for the whole item, processing included", () => {
    expect(problems(context(), request("cut", "ethan", "16:30"))).toEqual([{ code: "staff_unavailable", reason: "not_working" }]);
    expect(codes(context(), request("cut", "ethan", "16:00"))).toEqual([]);
    expect(problems(context(), request("cut", "ethan", "08:30"))).toEqual([{ code: "staff_unavailable", reason: "location_closed" }]);
  });

  it("respects split shifts: nothing runs into the break", () => {
    // Priya is off 1-2pm.
    expect(problems(context(), request("cut", "priya", "12:30"))).toEqual([{ code: "staff_unavailable", reason: "not_working" }]);
    // Even when only the processing time would fall in the break.
    expect(problems(context(), request("color", "priya", "11:30"))).toEqual([{ code: "staff_unavailable", reason: "not_working" }]);
    expect(codes(context(), request("cut", "priya", "12:00"))).toEqual([]);
    expect(codes(context(), request("cut", "priya", "14:00"))).toEqual([]);
  });

  it("is closed on days the salon is closed", () => {
    // Monday.
    expect(problems(context(), request("cut", "ethan", "10:00", null, "2026-10-26"))).toEqual([
      { code: "staff_unavailable", reason: "location_closed" },
    ]);
  });

  it("blocks approved time off, whole-day and part-day", () => {
    const withTimeOff = (timeOff: StaffSchedule["timeOff"]) =>
      context({ staff: new Map([["ethan", { ...ethan, schedule: { ...ethan.schedule, timeOff } }]]) });

    const vacation = withTimeOff([{ startsOn: "2026-10-26", endsOn: "2026-10-30", status: "approved" }]);
    expect(problems(vacation, request("cut", "ethan", "10:00"))).toEqual([{ code: "staff_unavailable", reason: "time_off" }]);

    const dentist = withTimeOff([{ startsOn: TUESDAY, endsOn: TUESDAY, startMinute: h(14), endMinute: h(15), status: "approved" }]);
    expect(problems(dentist, request("cut", "ethan", "13:30"))).toEqual([{ code: "staff_unavailable", reason: "time_off" }]);
    expect(codes(dentist, request("cut", "ethan", "13:00"))).toEqual([]);
    expect(codes(dentist, request("cut", "ethan", "15:00"))).toEqual([]);
  });

  it("ignores pending and declined time off", () => {
    const ctx = context({
      staff: new Map([
        [
          "ethan",
          {
            ...ethan,
            schedule: {
              ...ethan.schedule,
              timeOff: [
                { startsOn: TUESDAY, endsOn: TUESDAY, status: "requested" },
                { startsOn: TUESDAY, endsOn: TUESDAY, status: "declined" },
              ],
            },
          },
        ],
      ]),
    });
    expect(codes(ctx, request("cut", "ethan", "10:00"))).toEqual([]);
  });

  it("uses a one-off change instead of the weekly hours", () => {
    const late: BookingStaff = { ...ethan, schedule: { ...ethan.schedule, overrides: { [TUESDAY]: [span(h(12), h(19))] } } };
    const ctx = context({ staff: new Map([["ethan", late]]) });
    expect(problems(ctx, request("cut", "ethan", "10:00"))).toEqual([{ code: "staff_unavailable", reason: "not_working" }]);
    expect(codes(ctx, request("cut", "ethan", "18:00"))).toEqual([]);
  });
});

describe("double-booking", () => {
  const ctx = context({ booked: [booked("cut-10", CUT, "ethan", "10:00")] });

  it("rejects the same time, and any partial overlap", () => {
    expect(problems(ctx, request("cut", "ethan", "10:00"))).toEqual([{ code: "staff_double_booked", conflictWith: "cut-10" }]);
    expect(codes(ctx, request("cut", "ethan", "09:30"))).toEqual(["staff_double_booked"]);
    expect(codes(ctx, request("cut", "ethan", "10:55"))).toEqual(["staff_double_booked"]);
    // Inside it, and around it.
    expect(codes(ctx, request("bang-trim", "ethan", "10:20"))).toEqual(["staff_double_booked"]);
    expect(codes(context({ booked: [booked("trim", BANG_TRIM, "ethan", "10:20")] }), request("cut", "ethan", "10:00"))).toEqual([
      "staff_double_booked",
    ]);
  });

  it("allows back-to-back appointments", () => {
    expect(codes(ctx, request("cut", "ethan", "09:00"))).toEqual([]);
    expect(codes(ctx, request("cut", "ethan", "11:00"))).toEqual([]);
  });

  it("allows another stylist at the same time", () => {
    expect(codes(ctx, request("cut", "priya", "10:00"))).toEqual([]);
  });

  it("doesn't conflict with itself when an item is moved", () => {
    expect(codes(ctx, { ...request("cut", "ethan", "10:30"), id: "cut-10" })).toEqual([]);
    // But still with others.
    const two = context({ booked: [booked("cut-10", CUT, "ethan", "10:00"), booked("cut-12", CUT, "ethan", "12:00")] });
    expect(problems(two, { ...request("cut", "ethan", "11:30"), id: "cut-10" })).toEqual([
      { code: "staff_double_booked", conflictWith: "cut-12" },
    ]);
  });

  it("can ignore a whole appointment that's being rebooked", () => {
    const result = checkItem(ctx, request("cut", "ethan", "10:00"), [], { replacingAppointmentId: "appt-cut-10" });
    expect(result.valid).toBe(true);
  });
});

describe("processing gaps", () => {
  // Priya's color at 10:00: busy 10:00-10:45, free 10:45-11:20, busy 11:20-11:45.
  const ctx = context({ booked: [booked("color", COLOR, "priya", "10:00", "chair-1")] });

  it("lets the stylist take another client during processing", () => {
    expect(codes(ctx, request("mens-cut", "priya", "10:45", "chair-2"))).toEqual([]);
    expect(codes(ctx, request("bang-trim", "priya", "11:05", "chair-2"))).toEqual([]);
  });

  it("rejects a client whose busy time doesn't fit in the gap", () => {
    // Starts in the gap but runs into finishing.
    expect(problems(ctx, request("mens-cut", "priya", "11:00", "chair-2"))).toEqual([
      { code: "staff_double_booked", conflictWith: "color" },
    ]);
    // Starts before the gap opens.
    expect(codes(ctx, request("bang-trim", "priya", "10:40", "chair-2"))).toEqual(["staff_double_booked"]);
    // Longer than the gap.
    expect(codes(ctx, request("cut", "priya", "10:45", "chair-2"))).toEqual(["staff_double_booked"]);
  });

  it("lets two services process at the same time", () => {
    // Mask in the gap: busy 10:45-10:55, then processing alongside the color.
    expect(codes(ctx, request("mask", "priya", "10:45", "chair-2"))).toEqual([]);
    // Mask just before: busy 9:50-10:00, processing while the color is applied.
    expect(codes(ctx, request("mask", "priya", "09:50", "chair-2"))).toEqual([]);
  });

  it("lets a new service's processing time cover an existing client", () => {
    // Existing bang trim 10:15-10:30. A gloss at 10:00 is busy 10:00-10:15,
    // processing 10:15-10:35 (the bang trim fits here), busy 10:35-10:50.
    const trim = context({ booked: [booked("trim", BANG_TRIM, "priya", "10:15", "chair-2")] });
    expect(codes(trim, request("gloss", "priya", "10:00", "chair-1"))).toEqual([]);
    // Five minutes later its processing no longer covers the trim.
    expect(problems(trim, request("gloss", "priya", "10:05", "chair-1"))).toEqual([{ code: "staff_double_booked", conflictWith: "trim" }]);
  });

  it("checks the finishing part too", () => {
    // Gloss at 9:30 finishes 10:05-10:20, during the color's application.
    expect(codes(ctx, request("gloss", "priya", "09:30", "chair-2"))).toEqual(["staff_double_booked"]);
    // Gloss at 9:15 finishes 9:50-10:05: overlaps 10:00-10:05.
    expect(codes(ctx, request("gloss", "priya", "09:15", "chair-2"))).toEqual(["staff_double_booked"]);
    // Gloss at 9:10 finishes at 10:00 exactly.
    expect(codes(ctx, request("gloss", "priya", "09:10", "chair-2"))).toEqual([]);
  });

  it("still holds the chair during processing", () => {
    expect(problems(ctx, request("mens-cut", "priya", "10:45", "chair-1"))).toEqual([{ code: "resource_in_use", conflictWith: "color" }]);
    // Another stylist can't use the chair while the color processes either.
    expect(problems(ctx, request("mens-cut", "ethan", "10:50", "chair-1"))).toEqual([{ code: "resource_in_use", conflictWith: "color" }]);
  });
});

describe("resources", () => {
  const ctx = context({ booked: [booked("cut-10", CUT, "ethan", "10:00", "chair-1")] });

  it("rejects a chair that's in use", () => {
    expect(problems(ctx, request("cut", "priya", "10:30", "chair-1"))).toEqual([{ code: "resource_in_use", conflictWith: "cut-10" }]);
  });

  it("allows the chair before and after, and another chair", () => {
    expect(codes(ctx, request("cut", "priya", "11:00", "chair-1"))).toEqual([]);
    expect(codes(ctx, request("cut", "priya", "09:00", "chair-1"))).toEqual([]);
    expect(codes(ctx, request("cut", "priya", "10:30", "chair-2"))).toEqual([]);
  });

  it("rejects unknown and out-of-use resources", () => {
    expect(codes(ctx, request("cut", "priya", "11:00", "chair-9"))).toEqual(["unknown_resource"]);
    expect(codes(ctx, request("cut", "priya", "11:00", "broken-chair"))).toEqual(["resource_inactive"]);
  });
});

describe("items already booked", () => {
  it("keep their booked timing when moved", () => {
    // Booked when the color took 30 minutes to apply; the menu now says 45.
    const old = { activeMinutes: 30, processingMinutes: 35, finishingMinutes: 25 };
    const result = checkItem(context(), { ...request("color", "priya", "11:30"), id: "c", timing: old });
    // 11:30 + 90 minutes ends 1pm, right at Priya's break; with the menu's 105 it wouldn't fit.
    expect(result).toEqual({ valid: true, item: expect.objectContaining({ activeMinutes: 30, start: at("11:30") }) });
    expect(codes(context(), request("color", "priya", "11:30"))).toEqual(["staff_unavailable"]);
  });

  it("can be moved after their service is archived", () => {
    const timing = { activeMinutes: 45, processingMinutes: 30, finishingMinutes: 30 };
    expect(codes(context(), { ...request("perm", "priya", "09:00"), id: "p", timing })).toEqual([]);
    expect(codes(context(), request("perm", "priya", "09:00"))).toEqual(["service_archived"]);
  });
});

describe("picking a chair", () => {
  const draft = (time: string, svc = CUT, staffId = "ethan"): BookedItem => ({ ...booked("new", svc, staffId, time), id: undefined });

  it("takes the first free chair in the salon's order", () => {
    expect(pickResource(context(), draft("10:00"))).toBe("chair-1");
    const busy = context({ booked: [booked("a", CUT, "priya", "10:00", "chair-1")] });
    expect(pickResource(busy, draft("10:30"))).toBe("chair-2");
    expect(pickResource(busy, draft("11:00"))).toBe("chair-1");
  });

  it("prefers the given chair when it's free", () => {
    expect(pickResource(context(), draft("10:00"), "chair-2")).toBe("chair-2");
    const busy = context({ booked: [booked("a", CUT, "priya", "10:00", "chair-2")] });
    expect(pickResource(busy, draft("10:00"), "chair-2")).toBe("chair-1");
    // A room can be preferred, but isn't picked otherwise.
    expect(pickResource(context(), draft("10:00"), "room")).toBe("room");
  });

  it("holds chairs through processing, skips ones out of use, and counts items booked alongside", () => {
    const color = context({ booked: [booked("c", COLOR, "priya", "10:00", "chair-1")] });
    expect(pickResource(color, draft("10:50", MENS_CUT, "priya"))).toBe("chair-2");
    expect(pickResource(color, draft("10:50"), null, [booked("x", CUT, "ethan", "10:30", "chair-2")])).toBeNull();
  });

  it("doesn't clash with the item's own booked copy", () => {
    const ctx = context({ booked: [booked("cut", CUT, "ethan", "10:00", "chair-1")] });
    expect(pickResource(ctx, { ...booked("cut", CUT, "ethan", "10:30", "chair-1") }, "chair-1")).toBe("chair-1");
  });
});

describe("several problems at once", () => {
  it("reports them all", () => {
    const ctx = context({ booked: [booked("cut-10", CUT, "ethan", "10:00", "chair-1")] });
    expect(codes(ctx, request("color", "ethan", "10:03", "chair-1"))).toEqual([
      "service_not_offered",
      "invalid_start",
      "staff_double_booked",
      "resource_in_use",
    ]);
  });

  it("stops at an unknown service: there's no timing to check", () => {
    expect(codes(context(), request("nope", "nobody", "03:00", "chair-9"))).toEqual(["unknown_service", "unknown_staff", "unknown_resource"]);
  });
});

describe("appointments with several items", () => {
  it("books a color with one stylist and a cut with another straight after", () => {
    const result = checkAppointment(context(), [request("color", "priya", "10:00", "chair-1"), request("cut", "ethan", "11:45", "chair-1")]);
    expect(result.valid).toBe(true);
  });

  it("checks items against each other", () => {
    // The cut would start in chair 1 while the color is still there.
    const chair = checkAppointment(context(), [request("color", "priya", "10:00", "chair-1"), request("cut", "ethan", "11:30", "chair-1")]);
    expect(chair.valid).toBe(false);
    expect(chair.items[0].valid).toBe(true);
    expect(chair.items[1]).toEqual({ valid: false, problems: [{ code: "resource_in_use", conflictWith: undefined }] });

    // Two items for one stylist at once.
    const stylist = checkAppointment(context(), [request("cut", "ethan", "10:00"), request("bang-trim", "ethan", "10:30")]);
    expect(stylist.items.map((c) => c.valid)).toEqual([true, false]);
  });

  it("only checks later items against the earlier items that were valid", () => {
    const result = checkAppointment(context(), [request("color", "ethan", "10:00"), request("cut", "ethan", "10:00")]);
    expect(result.items.map((c) => c.valid)).toEqual([false, true]);
    expect(result.valid).toBe(false);
  });

  it("isn't valid with no items", () => {
    expect(checkAppointment(context(), []).valid).toBe(false);
  });
});

describe("moving several items at once", () => {
  const move = (itemId: string, staffId: string, time: string, resourceId: string | null = null) => ({ itemId, staffId, resourceId, start: at(time) });

  it("checks each move without the moved items' old places", () => {
    // Two back-to-back cuts with Priya, both shifted 30 minutes: the first
    // lands where the second was.
    const ctx = context({ booked: [booked("a", CUT, "priya", "10:00"), booked("b", CUT, "priya", "11:00")] });
    expect(checkMoves(ctx, [move("a", "priya", "10:30"), move("b", "priya", "11:30")])).toEqual({ valid: true, problems: [[], []] });
  });

  it("checks the moves against each other", () => {
    const ctx = context({ booked: [booked("a", CUT, "priya", "10:00"), booked("b", CUT, "priya", "11:00")] });
    const result = checkMoves(ctx, [move("a", "priya", "11:30"), move("b", "priya", "12:00")]);
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([[], [{ code: "staff_double_booked", conflictWith: "a" }]]);
  });

  it("checks against items that stay, chairs, and the new stylist's hours and services", () => {
    const ctx = context({ booked: [booked("a", CUT, "priya", "10:00", "chair-1"), booked("c", CUT, "ethan", "12:00", "chair-2")] });
    expect(checkMoves(ctx, [move("a", "ethan", "11:30")]).problems).toEqual([[{ code: "staff_double_booked", conflictWith: "c" }]]);
    expect(checkMoves(ctx, [move("a", "priya", "12:30", "chair-2")]).problems[0].map((p) => p.code)).toEqual(["staff_unavailable", "resource_in_use"]);
    const color = context({ booked: [booked("k", COLOR, "priya", "10:00")] });
    expect(checkMoves(color, [move("k", "ethan", "10:00")]).problems).toEqual([[{ code: "service_not_offered" }]]);
  });

  it("keeps each item's booked timing", () => {
    // Booked when the cut was 30 minutes; the menu now says 60.
    const short = { ...booked("a", CUT, "priya", "10:00"), activeMinutes: 30 };
    const ctx = context({ booked: [short, booked("b", CUT, "priya", "11:00")] });
    expect(checkMoves(ctx, [move("a", "priya", "10:30")]).valid).toBe(true);
  });

  it("uses processing gaps", () => {
    const ctx = context({ booked: [booked("k", COLOR, "priya", "10:00"), booked("m", MENS_CUT, "priya", "15:00")] });
    // Priya is free 10:45-11:20 while the color processes.
    expect(checkMoves(ctx, [move("m", "priya", "10:45")]).valid).toBe(true);
    expect(checkMoves(ctx, [move("m", "priya", "10:55")]).valid).toBe(false);
  });

  it("reports items that aren't on the calendar", () => {
    expect(checkMoves(context(), [move("gone", "priya", "10:00")]).problems).toEqual([[{ code: "not_booked" }]]);
  });
});

describe("messages", () => {
  it("describes every problem", () => {
    const all: BookingProblem[] = [
      { code: "unknown_service" },
      { code: "service_archived" },
      { code: "unknown_staff" },
      { code: "staff_inactive" },
      { code: "service_not_offered" },
      { code: "invalid_start" },
      { code: "staff_unavailable", reason: "location_closed" },
      { code: "staff_unavailable", reason: "not_working" },
      { code: "staff_unavailable", reason: "time_off" },
      { code: "staff_unavailable", reason: "invalid_duration" },
      { code: "staff_unavailable", reason: "crosses_midnight" },
      { code: "staff_double_booked" },
      { code: "unknown_resource" },
      { code: "resource_inactive" },
      { code: "resource_in_use" },
      { code: "no_free_resource" },
      { code: "not_booked" },
    ];
    const messages = all.map(describeProblem);
    expect(new Set(messages).size).toBe(all.length);
    expect(messages.every((m) => m.endsWith("."))).toBe(true);
    expect(describeProblem({ code: "staff_double_booked" })).toBe("The stylist already has a client then.");
  });
});
