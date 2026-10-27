// Sick-day rescue: the plan for a stylist who's out, over the booking rules.
import { describe, expect, it } from "vitest";
import { checkMoves, fromLocal, itemEnd, parseTime, staffBusySpans, timingFor, type BookedItem, type BookingContext, type ServiceTiming } from "@/lib/scheduling";
import { affectedVisits, chosenMoves, planProblems, planRescue, withMoves, type RescueInput, type RescueStylist, type RescueVisit } from "@/lib/scheduling/rescue";

const TZ = "America/Chicago";
const TUE = "2026-10-27";
const at = (time: string, day = TUE) => fromLocal(day, parseTime(time)!, TZ)!;
const m = (time: string) => parseTime(time)!;
const hhmm = (d: Date) => {
  const local = new Date(d.toLocaleString("en-US", { timeZone: TZ }));
  return `${local.getHours()}:${String(local.getMinutes()).padStart(2, "0")}`;
};

const CUT = { id: "cut", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false };
const COLOR = { id: "color", activeMinutes: 45, processingMinutes: 35, finishingMinutes: 25, archived: false };
const BLOW = { id: "blow", activeMinutes: 45, processingMinutes: 0, finishingMinutes: 0, archived: false };
const shift = (from: string, to: string) => ({ start: m(from), end: m(to) });
const week = { 2: [shift("9:00", "17:00")], 3: [shift("9:00", "17:00")], 4: [shift("9:00", "17:00")], 5: [shift("9:00", "17:00")] };
type Off = { startsOn: string; endsOn: string; startMinute?: number; endMinute?: number; status: "approved" };
const person = (id: string, services: string[], timeOff: Off[] = []) => ({
  id,
  isActive: true,
  schedule: { weekly: week, overrides: {}, timeOff },
  serviceIds: new Set(services),
});

const STYLISTS: RescueStylist[] = [
  { id: "nola", firstName: "Nola", level: "senior" },
  { id: "lois", firstName: "Lois", level: "senior" },
  { id: "gil", firstName: "Gil", level: "master" },
  { id: "shae", firstName: "Shae", level: "artisan" },
];

// Nola is out from `from` (a time on Tuesday, in minutes) to the end of the day.
function ctx(booked: BookedItem[], from = 0, staff = ["nola", "lois", "gil", "shae"], outUntil = TUE): BookingContext {
  const services: Record<string, string[]> = { nola: ["cut", "color", "blow"], lois: ["cut", "blow"], gil: ["cut", "color", "blow"], shae: ["cut", "blow"] };
  return {
    location: { timeZone: TZ, weekly: week },
    services: new Map([CUT, COLOR, BLOW].map((s) => [s.id, s])),
    staff: new Map(staff.map((id) => [id, person(id, services[id], id === "nola" ? [{ startsOn: TUE, endsOn: outUntil, startMinute: from, endMinute: 1440, status: "approved" }] : [])])),
    resources: new Map(["c1", "c2", "c3", "c4", "c5"].map((id, i) => [id, { id, isActive: true, kind: "chair" as const, sortOrder: i }])),
    booked,
    blocks: [],
  };
}

let n = 0;
const item = (svc: typeof CUT, staffId: string, time: string, appointmentId: string, resourceId = `c${(n++ % 5) + 1}`, day = TUE) => ({
  id: `i-${appointmentId}-${svc.id}-${staffId}`,
  appointmentId,
  serviceId: svc.id,
  staffId,
  resourceId,
  start: at(time, day),
  activeMinutes: svc.activeMinutes,
  processingMinutes: svc.processingMinutes,
  finishingMinutes: svc.finishingMinutes,
});
const visit = (id: string, items: ReturnType<typeof item>[], extra: Partial<RescueVisit> = {}): RescueVisit => ({
  appointmentId: id,
  clientId: `client-${id}`,
  movable: true,
  items,
  preferredStaffId: null,
  onlySees: false,
  ...extra,
});

function input(c: BookingContext, visits: RescueVisit[], from = at("0:00"), timingOf?: RescueInput["timingOf"]): RescueInput {
  return { staffId: "nola", date: TUE, from, visits, stylists: STYLISTS, timingOf: timingOf ?? ((s, v) => timingFor(c, s, v)), now: at("7:00"), days: 7 };
}

function plan(visits: RescueVisit[], others: BookedItem[] = [], from = "0:00", timingOf?: RescueInput["timingOf"]) {
  const c = ctx([...visits.flatMap((v) => v.items), ...others], m(from));
  return { c, lines: planRescue(c, input(c, visits, at(from), timingOf)) };
}

const chosen = (l: ReturnType<typeof planRescue>[number]) => (l.choice === null ? null : l.options[l.choice]);

describe("who's affected", () => {
  it("is every visit with them for a full day, and only from the time for part of one", () => {
    const visits = [visit("a", [item(CUT, "nola", "9:00", "a")]), visit("b", [item(CUT, "nola", "12:30", "b")]), visit("c", [item(CUT, "nola", "15:00", "c")])];
    expect(affectedVisits(visits, "nola", at("0:00")).map((v) => v.appointmentId)).toEqual(["a", "b", "c"]);
    // Leaving at 1: the 12:30 cut runs past it, so it's affected too.
    expect(affectedVisits(visits, "nola", at("13:00")).map((v) => v.appointmentId)).toEqual(["b", "c"]);
    // Coming in at 1pm: only what starts before then.
    expect(affectedVisits(visits, "nola", at("0:00"), at("13:00")).map((v) => v.appointmentId)).toEqual(["a", "b"]);
  });

  it("puts visits that start together in booking order, whatever order they came in", () => {
    const first = { ...visit("z", [item(CUT, "nola", "9:00", "z")]), bookedAt: at("1:00") };
    const second = { ...visit("a", [item(CUT, "nola", "9:00", "a")]), bookedAt: at("2:00") };
    expect(affectedVisits([second, first], "nola", at("0:00")).map((v) => v.appointmentId)).toEqual(["z", "a"]);
    expect(affectedVisits([first, second], "nola", at("0:00")).map((v) => v.appointmentId)).toEqual(["z", "a"]);
  });
});

describe("the plan", () => {
  it("covers at the same time with a stylist at the same level first", () => {
    const { lines } = plan([visit("a", [item(CUT, "nola", "10:00", "a")])]);
    const best = chosen(lines[0])!;
    expect(best).toMatchObject({ kind: "cover", staffId: "lois", shift: 0, sameLevel: true });
    expect(best.start).toEqual(at("10:00"));
    // Other choices follow: Gil and Shae at the same time, then other days.
    expect(lines[0].options.slice(1, 3).map((o) => [o.kind, o.staffId, o.sameLevel])).toEqual([
      ["cover", "gil", false],
      ["cover", "shae", false],
    ]);
    expect(lines[0].options.some((o) => o.kind === "reschedule" && o.staffId === "nola")).toBe(true);
  });

  it("gives a color only to someone who does color", () => {
    const { lines } = plan([visit("a", [item(COLOR, "nola", "10:00", "a")])]);
    expect(new Set(lines[0].options.filter((o) => o.kind !== "reschedule").map((o) => o.staffId))).toEqual(new Set(["gil"]));
  });

  it("moves a little later when no one's free at the time", () => {
    const busy = [item(CUT, "lois", "10:00", "x"), item(CUT, "gil", "10:00", "y"), item(CUT, "shae", "10:00", "z")];
    const { lines } = plan([visit("a", [item(CUT, "nola", "10:00", "a")])], busy);
    const best = chosen(lines[0])!;
    expect(best).toMatchObject({ kind: "shift", staffId: "lois", shift: 60 });
    expect(best.start).toEqual(at("11:00"));
  });

  it("never gives two clients the same stylist at the same time", () => {
    const visits = [visit("a", [item(CUT, "nola", "10:00", "a")]), visit("b", [item(CUT, "nola", "10:00", "b")]), visit("c", [item(CUT, "nola", "10:00", "c")])];
    const { c, lines } = plan(visits, [item(CUT, "shae", "10:00", "z")]);
    // Lois and Gil cover two; the third waits or moves.
    expect(lines.map((l) => chosen(l)!.staffId).slice(0, 2)).toEqual(["lois", "gil"]);
    expect(chosen(lines[2])!.kind).not.toBe("cover");
    const moves = chosenMoves(lines, lines.map((l) => l.choice));
    expect(checkMoves(c, moves).valid).toBe(true);
    const after = withMoves(c, moves);
    for (const a of after.booked) {
      for (const b of after.booked) {
        if (a === b || a.staffId !== b.staffId) continue;
        const clash = staffBusySpans(a).some((x) => staffBusySpans(b).some((y) => x.start < y.end && y.start < x.end));
        expect(clash, `${a.id} and ${b.id}`).toBe(false);
      }
    }
    expect(planProblems(c, lines, lines.map((l) => l.choice))).toEqual([]);
  });

  it("offers every stylist to every client, and finds it when staff choose two that clash", () => {
    const visits = [visit("a", [item(CUT, "nola", "10:00", "a")]), visit("b", [item(CUT, "nola", "10:00", "b")])];
    const { c, lines } = plan(visits);
    // b starts with Gil, but Lois at 10 is on offer too (in case a moves).
    expect(chosen(lines[1])).toMatchObject({ staffId: "gil" });
    const lois = lines[1].options.findIndex((o) => o.kind === "cover" && o.staffId === "lois");
    expect(lois).toBeGreaterThanOrEqual(0);
    expect(planProblems(c, lines, [lines[0].choice, lines[1].choice])).toEqual([]);
    // Both on Lois at 10: the first keeps its place; the second no longer fits.
    expect(planProblems(c, lines, [lines[0].choice, lois])).toEqual([1]);
    // a left as it is: b can have Lois.
    expect(planProblems(c, lines, [null, lois])).toEqual([]);
  });

  it("checks the covering stylist at their own length", () => {
    // Lois usually takes 90 minutes for a cut, and has a client at 11.
    const slow: ServiceTiming = { activeMinutes: 90, processingMinutes: 0, finishingMinutes: 0 };
    const c0 = ctx([]);
    const timingOf = (s: string, v: string) => (s === "lois" && v === "cut" ? slow : timingFor(c0, s, v));
    const { lines } = plan([visit("a", [item(CUT, "nola", "10:00", "a")])], [item(CUT, "lois", "11:00", "x")], "0:00", timingOf);
    expect(lines[0].options.some((o) => o.kind === "cover" && o.staffId === "lois")).toBe(false);
    const lois = lines[0].options.find((o) => o.staffId === "lois")!;
    expect(lois.moves[0].timing).toEqual(slow);
  });

  it("keeps processing time free for others, and the color client's chair through it", () => {
    // Gil has a cut at 10:45, inside a 10:00 color's processing (10:45–11:20).
    const { lines } = plan([visit("a", [item(COLOR, "nola", "10:00", "a", "c1")])], [item({ ...CUT, activeMinutes: 30 }, "gil", "10:45", "x", "c2")]);
    const best = chosen(lines[0])!;
    expect(best).toMatchObject({ kind: "cover", staffId: "gil", shift: 0 });
    expect(best.moves[0].resourceId).toBe("c1");
  });

  it("keeps the rest of a visit with its own stylist, moving it with the out part", () => {
    // Nola's color, then Shae's blow-dry straight after; Gil (the only other colorist) is busy at 10.
    const v = visit("a", [item(COLOR, "nola", "10:00", "a", "c1"), item(BLOW, "shae", "11:45", "a", "c2")]);
    const { lines } = plan([v], [item(CUT, "gil", "10:00", "x", "c3")]);
    const best = chosen(lines[0])!;
    expect(best.kind).toBe("shift");
    expect(best.moves.map((mv) => [mv.staffId, hhmm(mv.start)])).toEqual([
      ["gil", "11:00"],
      ["shae", "12:45"],
    ]);
  });

  it("leaves a visit in the chair where it is", () => {
    const { lines } = plan([visit("a", [item(CUT, "nola", "12:30", "a")], { movable: false })], [], "13:00");
    expect(lines[0]).toMatchObject({ options: [], choice: null, note: "in_chair" });
  });

  it("offers clients who only see this stylist only their stylist's openings", () => {
    const { lines } = plan([visit("a", [item(CUT, "nola", "10:00", "a")], { onlySees: true, preferredStaffId: "nola" })]);
    expect(lines[0].note).toBe("only_sees");
    expect(lines[0].options.length).toBeGreaterThan(0);
    expect(lines[0].options.every((o) => o.kind === "reschedule" && o.staffId === "nola")).toBe(true);
    // The next two days Nola works, nearest the time they booked.
    expect(lines[0].options.map((o) => [o.date, hhmm(o.start)])).toEqual([
      ["2026-10-28", "10:00"],
      ["2026-10-29", "10:00"],
    ]);
  });

  it("starts clients who prefer this stylist on a reschedule, with cover still on offer", () => {
    const { lines } = plan([visit("a", [item(CUT, "nola", "10:00", "a")], { preferredStaffId: "nola" })]);
    expect(lines[0].note).toBe("prefers");
    expect(chosen(lines[0])).toMatchObject({ kind: "reschedule", staffId: "nola", date: "2026-10-28" });
    expect(lines[0].options[0]).toMatchObject({ kind: "cover", staffId: "lois" });
  });

  it("offers another day at the same level when the stylist isn't back soon", () => {
    // Nola's out all week.
    const out = ctx([item(CUT, "nola", "10:00", "a")], 0, undefined, "2026-11-04");
    const v = visit("a", [item(CUT, "nola", "10:00", "a")], { preferredStaffId: "nola" });
    const lines = planRescue(out, { ...input(out, [v]), days: 7 });
    const later = lines[0].options.filter((o) => o.kind === "reschedule");
    expect(later.map((o) => o.staffId)).toEqual(["lois"]);
    expect(later[0]).toMatchObject({ sameLevel: true, date: "2026-10-28" });
  });

  it("never moves anyone into the past", () => {
    const c = ctx([item(CUT, "nola", "10:00", "a"), item(CUT, "lois", "10:00", "x"), item(CUT, "gil", "10:00", "y"), item(CUT, "shae", "10:00", "z")]);
    const v = visit("a", [item(CUT, "nola", "10:00", "a")]);
    const lines = planRescue(c, { ...input(c, [v]), now: at("10:20") });
    for (const o of lines[0].options) expect(o.start.getTime()).toBeGreaterThanOrEqual(at("10:20").getTime());
  });

  it("says when nothing fits", () => {
    const c = ctx([item(COLOR, "nola", "10:00", "a")], 0, ["nola"]);
    const v = visit("a", [item(COLOR, "nola", "10:00", "a")]);
    const lines = planRescue(c, { ...input(c, [v]), days: 0 });
    expect(lines[0]).toMatchObject({ options: [], choice: null, note: "none_fit" });
  });
});

it("ends each move at its new length", () => {
  const { lines } = plan([visit("a", [item(CUT, "nola", "10:00", "a")])]);
  const mv = chosen(lines[0])!.moves[0];
  expect(itemEnd({ ...mv, ...mv.timing, serviceId: "cut" })).toEqual(at("11:00"));
});
