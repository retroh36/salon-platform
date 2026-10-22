import { describe, expect, it } from "vitest";
import type { AppointmentStatus } from "@/lib/appointments";
import { checkMoves, fromLocal, itemEnd, parseTime, type BookedItem, type BookingContext, type BookingService, type BookingStaff } from "@/lib/scheduling";
import {
  activeDisruptions,
  effectiveCalendar,
  findConflicts,
  STYLIST_CHANGE_MINUTES,
  type Conflict,
  type Day,
  type Disruption,
  type FixOption,
} from "@/lib/scheduling/resolve";

const CHICAGO = "America/Chicago";
const TUESDAY = "2026-10-27";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const span = (from: number, to: number) => ({ start: from, end: to });

function at(time: string): Date {
  return fromLocal(TUESDAY, parseTime(time)!, CHICAGO)!;
}
const clock = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: CHICAGO, hour: "numeric", minute: "2-digit", hour12: false });

const service = (id: string, active: number, processing = 0, finishing = 0): BookingService => ({
  id,
  activeMinutes: active,
  processingMinutes: processing,
  finishingMinutes: finishing,
  archived: false,
});
const CUT = service("cut", 60);
const MENS_CUT = service("mens-cut", 30);
const LONG_CUT = service("long-cut", 90);
const COLOR = service("color", 45, 35, 25); // stylist free 0:45-1:20 in
const BLOWOUT = service("blowout", 45);
const SERVICES = [CUT, MENS_CUT, LONG_CUT, COLOR, BLOWOUT];

const stylist = (id: string, hours: { start: number; end: number }[], services: string[]): BookingStaff => ({
  id,
  isActive: true,
  schedule: { weekly: { 2: hours }, overrides: {}, timeOff: [] },
  serviceIds: new Set(services),
});

// Priya (senior): cuts and color, lunch 1-2. Ethan: cuts and blowouts.
// Sofia: color only. Nina: long cuts, mornings only.
const PRIYA = stylist("priya", [span(h(9), h(13)), span(h(14), h(18))], ["cut", "mens-cut", "color", "blowout"]);
const ETHAN = stylist("ethan", [span(h(9), h(17))], ["cut", "mens-cut", "blowout"]);
const SOFIA = stylist("sofia", [span(h(9), h(17))], ["color"]);
const NINA = stylist("nina", [span(h(9), h(14))], ["long-cut"]);

function context(booked: BookedItem[], staff: BookingStaff[] = [PRIYA, ETHAN, SOFIA, NINA]): BookingContext {
  return {
    location: { timeZone: CHICAGO, weekly: { 2: [span(h(9), h(19))] } },
    services: new Map(SERVICES.map((s) => [s.id, s])),
    staff: new Map(staff.map((s) => [s.id, s])),
    resources: new Map([
      ["chair-1", { id: "chair-1", isActive: true, kind: "chair" as const, sortOrder: 1 }],
      ["chair-2", { id: "chair-2", isActive: true, kind: "chair" as const, sortOrder: 2 }],
      ["chair-3", { id: "chair-3", isActive: true, kind: "chair" as const, sortOrder: 3 }],
    ]),
    booked,
  };
}

// An item on the calendar; its visit's id is `appt-<id>` unless given.
function item(id: string, svc: BookingService, staffId: string, time: string, extra: Partial<BookedItem> = {}): BookedItem {
  return {
    id,
    appointmentId: `appt-${id}`,
    serviceId: svc.id,
    staffId,
    resourceId: null,
    start: at(time),
    activeMinutes: svc.activeMinutes,
    processingMinutes: svc.processingMinutes,
    finishingMinutes: svc.finishingMinutes,
    ...extra,
  };
}

// Busy all day: a client every hour from 9 to 5 (cuts), so they can't help.
function fullDay(staffId: string, from = 9, to = 17): BookedItem[] {
  return Array.from({ length: to - from }, (_, i) => item(`${staffId}-busy-${i}`, CUT, staffId, `${from + i}:00`));
}

function day(booked: BookedItem[], disruptions: Disruption[], opts: { now?: string; statuses?: Record<string, AppointmentStatus>; staff?: BookingStaff[] } = {}): Day {
  const statuses = new Map<string, AppointmentStatus>(booked.map((b) => [b.appointmentId!, "booked"]));
  for (const [id, status] of Object.entries(opts.statuses ?? {})) statuses.set(id, status);
  return { ctx: context(booked, opts.staff), statuses, disruptions, now: at(opts.now ?? "8:00") };
}

// "grace: priya 11:20" for each move of an option.
const describe_ = (option: FixOption) => option.moves.map((m) => `${m.itemId}: ${m.to.staffId} ${clock(m.to.start)}`);

function only(conflicts: Conflict[]): Conflict {
  expect(conflicts).toHaveLength(1);
  return conflicts[0];
}

// Every option must pass the booking rules on the calendar as it will go.
function expectValid(d: Day, conflicts: Conflict[]) {
  const eff = effectiveCalendar(d.ctx, activeDisruptions(d));
  const withMoves = (o: FixOption) => ({
    ...eff,
    blocks: (eff.blocks ?? []).map((b) => {
      const m = o.blockMoves.find((x) => x.blockId === b.blockId && x.date === b.date);
      return m ? { ...b, ...m.to } : b;
    }),
  });
  for (const c of conflicts) {
    expect(c.options.length).toBeLessThanOrEqual(3);
    const scores = c.options.map((o) => o.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    for (const o of c.options) {
      expect(checkMoves(withMoves(o), o.moves.map((m) => ({ itemId: m.itemId, ...m.to }))).valid).toBe(true);
      for (const m of o.moves) {
        // Never earlier than booked, never into the past, never a checked-in client.
        expect(m.to.start.getTime()).toBeGreaterThanOrEqual(m.from.start.getTime());
        expect(m.to.start.getTime()).toBeGreaterThanOrEqual(d.now.getTime());
        expect(["booked", "confirmed"]).toContain(d.statuses.get(m.appointmentId));
      }
    }
  }
}

const checkedIn = (...ids: string[]) => Object.fromEntries(ids.map((id) => [`appt-${id}`, "checked_in" as const]));

// ---------------------------------------------------------------------------

describe("the effective calendar", () => {
  it("keeps the stylist busy longer for an overrun, after any processing", () => {
    const cut = item("cut", CUT, "priya", "10:00");
    const color = item("color", COLOR, "priya", "12:00");
    const eff = effectiveCalendar(context([cut, color]), [
      { id: "o1", kind: "overrun", itemId: "cut", minutes: 20 },
      { id: "o2", kind: "overrun", itemId: "color", minutes: 15 },
    ]);
    expect(eff.booked[0]).toMatchObject({ activeMinutes: 80, processingMinutes: 0, finishingMinutes: 0 });
    expect(eff.booked[1]).toMatchObject({ activeMinutes: 45, processingMinutes: 35, finishingMinutes: 40 });
  });

  it("starts a late client's whole visit later", () => {
    const color = item("color", COLOR, "priya", "10:00", { appointmentId: "visit" });
    const blowout = item("blowout", BLOWOUT, "ethan", "11:45", { appointmentId: "visit" });
    const eff = effectiveCalendar(context([color, blowout]), [{ id: "l", kind: "client_late", appointmentId: "visit", minutes: 15 }]);
    expect(eff.booked.map((b) => clock(b.start))).toEqual(["10:15", "12:00"]);
  });

  it("ignores reports that no longer apply: a finished overrun, a late client who arrived", () => {
    const d = day([item("a", CUT, "priya", "10:00"), item("b", CUT, "ethan", "10:00")], [
      { id: "o", kind: "overrun", itemId: "a", minutes: 20 },
      { id: "l", kind: "client_late", appointmentId: "appt-b", minutes: 10 },
    ], { statuses: { "appt-a": "completed", "appt-b": "checked_in" } });
    expect(activeDisruptions(d)).toEqual([]);
    expect(findConflicts(d)).toEqual([]);
  });
});

describe("a stylist running over", () => {
  it("is no conflict when the overrun fits in a gap", () => {
    const d = day([item("now", CUT, "priya", "10:00"), item("grace", CUT, "priya", "11:30")], [{ id: "o", kind: "overrun", itemId: "now", minutes: 20 }], {
      statuses: checkedIn("now"),
    });
    expect(findConflicts(d)).toEqual([]);
  });

  it("moves only the next client, a little later with the same stylist", () => {
    const booked = [item("now", CUT, "priya", "10:00"), item("grace", CUT, "priya", "11:00"), ...fullDay("ethan")];
    const d = day(booked, [{ id: "o", kind: "overrun", itemId: "now", minutes: 20 }], { statuses: checkedIn("now") });
    const conflicts = findConflicts(d);
    const c = only(conflicts);
    expect(c).toMatchObject({ subject: "overrun:o", kind: "overrun", staffId: "priya", minutes: 20, causeItemIds: ["now"], displaced: ["grace"], stuck: [] });
    expect(describe_(c.options[0])).toEqual(["grace: priya 11:20"]);
    expect(c.options[0]).toMatchObject({ clientsMoved: 1, shiftMinutes: 20, stylistChanges: 0, unresolved: [] });
    expectValid(d, conflicts);
  });

  it("prefers the same stylist a little later over another stylist now, but not a long wait", () => {
    const booked = [item("now", CUT, "priya", "10:00"), item("grace", CUT, "priya", "11:00")];
    const short = findConflicts(day(booked, [{ id: "o", kind: "overrun", itemId: "now", minutes: 20 }], { statuses: checkedIn("now") }));
    expect(only(short).options.map(describe_)).toEqual([["grace: priya 11:20"], ["grace: ethan 11:00"]]);

    const long = findConflicts(day(booked, [{ id: "o", kind: "overrun", itemId: "now", minutes: STYLIST_CHANGE_MINUTES + 15 }], { statuses: checkedIn("now") }));
    expect(describe_(only(long).options[0])).toEqual(["grace: ethan 11:00"]);
    expect(only(long).options.map(describe_)).toContainEqual(["grace: priya 11:45"]);
  });

  it("fits a short client into another client's processing gap", () => {
    // Priya runs an hour over (busy until 11); her 11:00 color leaves her
    // free 11:45-12:20 while it processes. After it, her lunch is in the
    // way until 2. Ethan is booked solid.
    const booked = [item("now", CUT, "priya", "9:00"), item("grace", MENS_CUT, "priya", "10:00"), item("ada", COLOR, "priya", "11:00"), ...fullDay("ethan")];
    const d = day(booked, [{ id: "o", kind: "overrun", itemId: "now", minutes: 60 }], { statuses: checkedIn("now") });
    const conflicts = findConflicts(d);
    const c = only(conflicts);
    expect(c.displaced).toEqual(["grace"]);
    expect(describe_(c.options[0])).toEqual(["grace: priya 11:45"]);
    expectValid(d, conflicts);
  });

  it("pushes the next client along when that's the only way", () => {
    // Nina works until 2. Her 10:00 runs 30 over; Grace's long cut can't go
    // after Ada's (it would end at 3), and no one else does long cuts.
    const booked = [item("now", LONG_CUT, "nina", "9:30"), item("grace", LONG_CUT, "nina", "11:00"), item("ada", CUT, "nina", "12:30", { serviceId: "long-cut" })];
    booked[2] = { ...booked[2], activeMinutes: 60 };
    const d = day(booked, [{ id: "o", kind: "overrun", itemId: "now", minutes: 30 }], { statuses: checkedIn("now") });
    const conflicts = findConflicts(d);
    const c = only(conflicts);
    expect(describe_(c.options[0])).toEqual(["grace: nina 11:30", "ada: nina 13:00"]);
    expect(c.options[0]).toMatchObject({ clientsMoved: 2, shiftMinutes: 60, unresolved: [] });
    expectValid(d, conflicts);
  });

  it("never moves a client who's checked in, and says who's stuck", () => {
    const booked = [item("now", CUT, "priya", "10:00"), item("grace", CUT, "priya", "11:00")];
    const d = day(booked, [{ id: "o", kind: "overrun", itemId: "now", minutes: 20 }], { statuses: checkedIn("now", "grace") });
    const c = only(findConflicts(d));
    expect(c).toMatchObject({ displaced: [], stuck: ["grace"], options: [] });
  });

  it("keeps a chair free for the next client in it", () => {
    // Ethan's 11:00 client is in Priya's chair after her; Priya's overrun
    // holds the chair, so Ethan's client takes another free chair.
    const booked = [item("now", CUT, "priya", "10:00", { resourceId: "chair-1" }), item("ben", CUT, "ethan", "11:00", { resourceId: "chair-1" })];
    const d = day(booked, [{ id: "o", kind: "overrun", itemId: "now", minutes: 15 }], { statuses: checkedIn("now") });
    const conflicts = findConflicts(d);
    const c = only(conflicts);
    expect(c.options[0].moves).toEqual([expect.objectContaining({ itemId: "ben", to: { staffId: "ethan", resourceId: "chair-2", start: at("11:00") } })]);
    // Same time, same stylist: no client is moved.
    expect(c.options[0]).toMatchObject({ clientsMoved: 0, shiftMinutes: 0, stylistChanges: 0 });
    expectValid(d, conflicts);
  });
});

describe("lunches and breaks", () => {
  const blockAt = (kind: "lunch" | "break" | "training", from: string, to: string) => ({ blockId: kind, date: TUESDAY, staffId: "priya", kind, start: at(from), end: at(to) });
  // Priya's 10:00 runs over into Grace at 11:00; Priya's lunch is at noon
  // and her afternoon starts at 2. Ethan is booked solid.
  function lunchDay(overrun: number, kind: "lunch" | "break" | "training" = "lunch", extra: BookedItem[] = []) {
    const d = day([item("now", CUT, "priya", "10:00"), item("grace", CUT, "priya", "11:00"), ...extra, ...fullDay("ethan")], [{ id: "o", kind: "overrun", itemId: "now", minutes: overrun }], {
      statuses: checkedIn("now"),
    });
    return { ...d, ctx: { ...d.ctx, blocks: [blockAt(kind, "12:00", "12:30")] } };
  }

  it("shifts lunch a little rather than make a client wait hours", () => {
    const d = lunchDay(20);
    const c = only(findConflicts(d));
    expect(describe_(c.options[0])).toEqual(["grace: priya 11:20"]);
    expect(c.options[0].blockMoves).toEqual([
      expect.objectContaining({ blockId: "lunch", kind: "lunch", from: { start: at("12:00"), end: at("12:30") }, to: { start: at("12:20"), end: at("12:50") } }),
    ]);
    expectValid(d, [c]);
  });

  it("never moves training, meetings or personal time", () => {
    const c = only(findConflicts(lunchDay(20, "training")));
    expect(c.options.every((o) => o.blockMoves.length === 0)).toBe(true);
    expect(describe_(c.options[0])).toEqual(["grace: priya 14:00"]);
  });

  it("moves a break by 30 minutes at most, and never onto a client", () => {
    for (const o of only(findConflicts(lunchDay(45))).options) {
      for (const m of o.blockMoves) expect(Math.abs(m.to.start.getTime() - m.from.start.getTime())).toBeLessThanOrEqual(30 * 60_000);
    }
    expect(only(findConflicts(lunchDay(45))).options[0].blockMoves).toEqual([]);
    // A client at 12:30 leaves nowhere for lunch to go.
    const busy = only(findConflicts(lunchDay(20, "lunch", [item("ada", MENS_CUT, "priya", "12:30")])));
    expect(busy.options[0].blockMoves).toEqual([]);
  });
});

describe("a stylist out for the rest of the day", () => {
  const out = (from: string): BookingStaff => ({
    ...PRIYA,
    schedule: { ...PRIYA.schedule, timeOff: [{ startsOn: TUESDAY, endsOn: TUESDAY, startMinute: parseTime(from), endMinute: 1440, status: "approved" }] },
  });

  it("hands each client to someone who does the service, at the same time", () => {
    const booked = [item("early", CUT, "priya", "9:00"), item("grace", CUT, "priya", "12:00"), item("ada", COLOR, "priya", "14:00")];
    const d = day(booked, [{ id: "c", kind: "call_out", staffId: "priya", from: at("11:30") }], { staff: [out("11:30"), ETHAN, SOFIA, NINA], now: "11:30" });
    const conflicts = findConflicts(d);
    const c = only(conflicts);
    expect(c).toMatchObject({ subject: "call_out:c", kind: "call_out", staffId: "priya", displaced: ["grace", "ada"], stuck: [] });
    expect(describe_(c.options[0])).toEqual(["grace: ethan 12:00", "ada: sofia 14:00"]);
    expect(c.options[0]).toMatchObject({ clientsMoved: 2, shiftMinutes: 0, stylistChanges: 2 });
    expectValid(d, conflicts);
  });

  it("leaves a client it can't place, and still moves the rest", () => {
    const booked = [item("grace", CUT, "priya", "12:00"), item("ada", COLOR, "priya", "14:00"), ...fullDay("sofia")];
    const d = day(booked, [{ id: "c", kind: "call_out", staffId: "priya", from: at("11:30") }], { staff: [out("11:30"), ETHAN, SOFIA, NINA], now: "11:30" });
    const conflicts = findConflicts(d);
    const c = only(conflicts);
    expect(c.options[0].unresolved).toEqual(["ada"]);
    expect(describe_(c.options[0])).toEqual(["grace: ethan 12:00"]);
    expectValid(d, conflicts);
  });

  it("leaves a checked-in client alone", () => {
    const booked = [item("chair", CUT, "priya", "11:00"), item("grace", CUT, "priya", "12:00")];
    const d = day(booked, [{ id: "c", kind: "call_out", staffId: "priya", from: at("11:30") }], {
      staff: [out("11:30"), ETHAN, SOFIA, NINA],
      statuses: checkedIn("chair"),
      now: "11:30",
    });
    const c = only(findConflicts(d));
    expect(c).toMatchObject({ displaced: ["grace"], stuck: ["chair"] });
    expect(c.options[0].moves.map((m) => m.itemId)).toEqual(["grace"]);
  });

  it("moves a client to a later time when no one is free straight away", () => {
    const booked = [item("grace", CUT, "priya", "12:00"), item("e1", CUT, "ethan", "12:00"), item("e2", CUT, "ethan", "13:00")];
    const d = day(booked, [{ id: "c", kind: "call_out", staffId: "priya", from: at("11:30") }], { staff: [out("11:30"), ETHAN, SOFIA, NINA], now: "11:30" });
    const conflicts = findConflicts(d);
    expect(describe_(only(conflicts).options[0])).toEqual(["grace: ethan 14:00"]);
    expectValid(d, conflicts);
  });
});

describe("a client running late", () => {
  it("shifts their visit when nothing else is affected", () => {
    const d = day([item("grace", CUT, "priya", "11:00")], [{ id: "l", kind: "client_late", appointmentId: "appt-grace", minutes: 15 }], { now: "10:55" });
    const conflicts = findConflicts(d);
    const c = only(conflicts);
    expect(c).toMatchObject({ subject: "late:l", kind: "client_late", staffId: "priya", minutes: 15, displaced: ["grace"] });
    expect(describe_(c.options[0])).toEqual(["grace: priya 11:15"]);
    expectValid(d, conflicts);
  });

  it("moves the late client rather than the next one", () => {
    // Grace's later start runs into Ada at 12:00. Moving Grace to Ethan
    // moves one client; pushing Ada along would move two (and to Ethan:
    // 12:15 with Priya would run into her lunch).
    const booked = [item("grace", CUT, "priya", "11:00"), item("ada", CUT, "priya", "12:00")];
    const d = day(booked, [{ id: "l", kind: "client_late", appointmentId: "appt-grace", minutes: 15 }], { now: "10:55" });
    const conflicts = findConflicts(d);
    const c = only(conflicts);
    expect(describe_(c.options[0])).toEqual(["grace: ethan 11:15"]);
    expect(c.options.map(describe_)).toContainEqual(["grace: priya 11:15", "ada: ethan 12:00"]);
    expectValid(d, conflicts);
  });

  it("keeps a multi-stylist visit together", () => {
    const color = item("color", COLOR, "priya", "10:00", { appointmentId: "visit" });
    const blowout = item("blowout", BLOWOUT, "ethan", "11:45", { appointmentId: "visit" });
    const d = day([color, blowout], [{ id: "l", kind: "client_late", appointmentId: "visit", minutes: 20 }], { now: "9:55" });
    const conflicts = findConflicts(d);
    expect(describe_(only(conflicts).options[0])).toEqual(["color: priya 10:20", "blowout: ethan 12:05"]);
    expect(only(conflicts).options[0]).toMatchObject({ clientsMoved: 1, shiftMinutes: 20 });
    expectValid(d, conflicts);
  });

  it("never books into the past", () => {
    // Reported late at 11:10 for 5 minutes past an 11:00 start: the
    // earliest is now.
    const d = day([item("grace", CUT, "priya", "11:00")], [{ id: "l", kind: "client_late", appointmentId: "appt-grace", minutes: 5 }], { now: "11:08" });
    expect(describe_(only(findConflicts(d)).options[0])).toEqual(["grace: priya 11:10"]);
  });
});

describe("double-bookings", () => {
  it("moves one of the two clients", () => {
    const booked = [item("a", CUT, "priya", "11:00"), item("b", CUT, "priya", "11:30")];
    const d = day(booked, []);
    const conflicts = findConflicts(d);
    const c = only(conflicts);
    expect(c).toMatchObject({ subject: "double:a:b", kind: "double_booking", staffId: "priya", causeItemIds: ["a", "b"] });
    // The later client moves: half an hour later with Priya, or to Ethan at
    // the same time (which counts the same); keeping the stylist wins.
    expect(c.options.slice(0, 2).map(describe_)).toEqual([["b: priya 12:00"], ["b: ethan 11:30"]]);
    expect(c.options.every((o) => o.clientsMoved === 1)).toBe(true);
    expectValid(d, conflicts);
  });

  it("only moves the one who hasn't checked in", () => {
    const booked = [item("a", CUT, "priya", "11:00"), item("b", CUT, "priya", "11:30")];
    const d = day(booked, [], { statuses: checkedIn("b"), now: "11:30" });
    const c = only(findConflicts(d));
    expect(c.options.length).toBeGreaterThan(0);
    expect(c.options.every((o) => o.moves.every((m) => m.itemId === "a"))).toBe(true);
  });

  it("reports a clash it can't fix when both have checked in", () => {
    const d = day([item("a", CUT, "priya", "11:00"), item("b", CUT, "priya", "11:30")], [], { statuses: checkedIn("a", "b"), now: "11:40" });
    expect(only(findConflicts(d))).toMatchObject({ displaced: [], stuck: ["a", "b"], options: [] });
  });

  it("finds none on a calendar that follows the rules", () => {
    expect(findConflicts(day([...fullDay("ethan"), item("p", COLOR, "priya", "10:00"), item("q", MENS_CUT, "priya", "10:45")], []))).toEqual([]);
  });
});

describe("a busy Saturday", () => {
  it("finds valid fixes quickly when a stylist with a full book calls out", () => {
    // Everyone booked most of the day, Priya out from 10:30 with six
    // clients left, and Ethan running 25 over.
    const booked: BookedItem[] = [];
    const priyas: [BookingService, string][] = [
      [CUT, "9:00"],
      [COLOR, "10:30"],
      [MENS_CUT, "11:15"], // in the color's processing gap
      [MENS_CUT, "12:15"],
      [CUT, "14:00"],
      [COLOR, "15:00"],
      [MENS_CUT, "16:45"],
    ];
    priyas.forEach(([svc, t], i) => booked.push(item(`priya-${i}`, svc, "priya", t)));
    ["9:00", "10:00", "12:00", "13:00", "15:30"].forEach((t, i) => booked.push(item(`ethan-${i}`, CUT, "ethan", t)));
    ["9:00", "11:00", "13:00", "15:00"].forEach((t, i) => booked.push(item(`sofia-${i}`, COLOR, "sofia", t)));
    const d = day(booked, [
      { id: "c", kind: "call_out", staffId: "priya", from: at("10:30") },
      { id: "o", kind: "overrun", itemId: "ethan-1", minutes: 25 },
    ], {
      staff: [
        { ...PRIYA, schedule: { ...PRIYA.schedule, timeOff: [{ startsOn: TUESDAY, endsOn: TUESDAY, startMinute: h(10, 30), endMinute: 1440, status: "approved" }] } },
        ETHAN,
        SOFIA,
        NINA,
      ],
      statuses: checkedIn("priya-0", "ethan-1", "sofia-0"),
      now: "10:30",
    });

    const started = performance.now();
    const conflicts = findConflicts(d);
    expect(performance.now() - started).toBeLessThan(3000);

    // Ethan's overrun fits before his noon client: only the call-out.
    const callOut = only(conflicts);
    expect(callOut.kind).toBe("call_out");
    expect(callOut.displaced).toHaveLength(6);
    expect(callOut.options).toHaveLength(3);
    // Ethan takes the 11:15 men's cut once his overrun ends; the colors
    // can't all fit around Sofia's.
    expect(describe_(callOut.options[0])).toContain("priya-2: ethan 11:25");
    expect(callOut.options[0].unresolved.length).toBeLessThan(6);
    expectValid(d, conflicts);
    // No option double-books anyone against the other stylists' days.
    for (const o of callOut.options) {
      for (const m of o.moves) expect(m.to.staffId).not.toBe("priya");
      expect(o.moves.every((m) => itemEnd({ ...booked.find((b) => b.id === m.itemId)!, start: m.to.start }) <= at("19:00"))).toBe(true);
    }
  });
});

describe("group bookings", () => {
  // Priya's 10:00 runs 30 minutes over. Ava (Priya, 11) and Bea (Ethan, 11)
  // are one party.
  const party = () => [item("ava", CUT, "priya", "11:00"), item("bea", CUT, "ethan", "11:00")];
  const groups = new Map([
    ["appt-ava", "bridal"],
    ["appt-bea", "bridal"],
  ]);
  const overrun: Disruption = { id: "o1", kind: "overrun", itemId: "first", minutes: 30 };

  it("moves the whole party together when there's room", () => {
    const d = { ...day([item("first", CUT, "priya", "10:00"), ...party()], [overrun], { staff: [PRIYA, ETHAN], now: "10:30", statuses: checkedIn("first") }), groups };
    const conflicts = findConflicts(d);
    const c = only(conflicts);
    expect(describe_(c.options[0])).toEqual(["ava: priya 11:30", "bea: ethan 11:30"]);
    expect(c.options[0]).toMatchObject({ clientsMoved: 2, shiftMinutes: 60 });
    expectValid(d, conflicts);

    // Without the group, only Ava would move.
    const alone = only(findConflicts({ ...d, groups: undefined }));
    expect(describe_(alone.options[0])).toEqual(["ava: priya 11:30"]);
  });

  it("splits the party only when it can't stay together within about an hour", () => {
    // Ethan has someone at 12, and Priya lunches at 1: the party could only
    // move together to 2pm.
    const d = {
      ...day([item("first", CUT, "priya", "10:00"), ...party(), item("later", CUT, "ethan", "12:00")], [overrun], { staff: [PRIYA, ETHAN], now: "10:30", statuses: checkedIn("first") }),
      groups,
    };
    const conflicts = findConflicts(d);
    const c = only(conflicts);
    expect(describe_(c.options[0])).toEqual(["ava: priya 11:30"]);
    expectValid(d, conflicts);
  });
});
