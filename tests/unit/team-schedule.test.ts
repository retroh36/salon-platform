import { describe, expect, it } from "vitest";
import { cycleWeek, hoursOn, patternHours } from "@/lib/scheduling/availability";
import {
  changesOf,
  clearWeek,
  copyWeek,
  dayTotals,
  dragShift,
  dropOnDay,
  newShift,
  outPanelHref,
  outside,
  scheduledMinutes,
  shiftProblem,
  trackRange,
  withEdit,
  type Cell,
} from "@/lib/team-schedule";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const nineToFive = { start: h(9), end: h(17) };
const cell = (over: Partial<Cell> = {}): Cell => ({ staffId: "s1", date: "2026-11-03", live: [nineToFive], draft: null, timeOff: [], booked: [], ...over });

describe("repeating patterns", () => {
  // Tuesdays every week; Saturdays every other week, from the week of Nov 2.
  const weekA = { 2: [nineToFive], 6: [nineToFive] };
  const weekB = { 2: [nineToFive] };
  const staff = { weekly: weekA, cycle: { startsOn: "2026-11-04", weeks: [weekA, weekB] }, overrides: {} as Record<string, { start: number; end: number }[]> };

  it("counts weeks from the week it starts, before it too", () => {
    expect(cycleWeek(staff.cycle, "2026-11-02")).toBe(0);
    expect(cycleWeek(staff.cycle, "2026-11-08")).toBe(0);
    expect(cycleWeek(staff.cycle, "2026-11-09")).toBe(1);
    expect(cycleWeek(staff.cycle, "2026-11-16")).toBe(0);
    expect(cycleWeek(staff.cycle, "2026-10-31")).toBe(1);
  });

  it("gives every other Saturday off", () => {
    expect(patternHours(staff, "2026-11-07")).toEqual([nineToFive]);
    expect(patternHours(staff, "2026-11-14")).toEqual([]);
    expect(patternHours(staff, "2026-11-21")).toEqual([nineToFive]);
    expect(patternHours(staff, "2026-11-10")).toEqual([nineToFive]);
  });

  it("lets a single day's change win, a day off included", () => {
    const changed = { ...staff, overrides: { "2026-11-07": [], "2026-11-14": [{ start: h(10), end: h(14) }] } };
    expect(hoursOn(changed, "2026-11-07")).toEqual([]);
    expect(hoursOn(changed, "2026-11-14")).toEqual([{ start: h(10), end: h(14) }]);
    expect(hoursOn(changed, "2026-11-21")).toEqual([nineToFive]);
  });

  it("is the weekly hours when it repeats every week", () => {
    expect(patternHours({ weekly: weekB, cycle: null }, "2026-11-07")).toEqual([]);
  });
});

describe("shifts", () => {
  it("are checked like the database checks them", () => {
    expect(shiftProblem([nineToFive])).toBeNull();
    expect(shiftProblem([{ start: h(9), end: h(13) }, { start: h(14), end: h(18) }])).toBeNull();
    expect(shiftProblem([{ start: h(9), end: h(13) }, { start: h(13), end: h(18) }])).toMatch(/overlap or touch/);
    expect(shiftProblem([{ start: h(9), end: h(9) }])).toMatch(/ends after/);
    expect(shiftProblem([{ start: 541, end: h(10) }])).toMatch(/5-minute/);
    expect(shiftProblem(Array.from({ length: 5 }, (_, i) => ({ start: h(i * 2), end: h(i * 2 + 1) })))).toMatch(/up to 4/);
  });

  it("drag by 15 minutes, stay on the track and clear of each other", () => {
    const range = { start: h(8), end: h(20) };
    const split = [{ start: h(9), end: h(13) }, { start: h(14), end: h(18) }];
    expect(dragShift([nineToFive], 0, "move", 55, range)).toEqual([{ start: h(10), end: h(18) }]);
    expect(dragShift([nineToFive], 0, "move", -600, range)).toEqual([{ start: h(8), end: h(16) }]);
    expect(dragShift([nineToFive], 0, "end", -70, range)).toEqual([{ start: h(9), end: h(15, 45) }]);
    expect(dragShift([nineToFive], 0, "start", 600, range)).toEqual([{ start: h(16, 30), end: h(17) }]);
    expect(dragShift(split, 0, "end", 60, range)).toBeNull();
    expect(dropOnDay(split, { start: h(18, 30), end: h(19, 30) })).toEqual([...split, { start: h(18, 30), end: h(19, 30) }]);
    expect(dropOnDay(split, nineToFive)).toBeNull();
  });

  it("start a new one on the salon's hours, or after the last", () => {
    expect(newShift([], [{ start: h(10), end: h(19) }])).toEqual({ start: h(10), end: h(19) });
    expect(newShift([], [])).toEqual(nineToFive);
    expect(newShift([{ start: h(9), end: h(13) }], [{ start: h(9), end: h(19) }])).toEqual({ start: h(14), end: h(19) });
  });

  it("set the grid's span from the opening hours and every shift", () => {
    expect(trackRange([{ start: h(9), end: h(18) }], [{ start: h(7, 30), end: h(12) }])).toEqual({ start: h(7), end: h(18) });
    expect(trackRange([], [])).toEqual({ start: h(7), end: h(21) });
  });
});

describe("the week", () => {
  it("adds up hours scheduled (less time off) and booked", () => {
    const a = cell({ booked: [{ appointmentId: "a", client: "Ava", start: h(10), end: h(11) }, { appointmentId: "b", client: "Ben", start: h(10, 30), end: h(12) }] });
    const b = cell({ staffId: "s2", live: [nineToFive], timeOff: [{ start: h(13), end: h(17) }] });
    expect(scheduledMinutes(b)).toBe(h(4));
    expect(dayTotals([a, b])).toEqual({ scheduled: h(12), booked: h(2) });
    expect(dayTotals([cell({ draft: [] })]).scheduled).toBe(0);
  });

  it("copies last week as shown, only the days that change", () => {
    const last = [cell({ date: "2026-10-27", live: [{ start: h(10), end: h(18) }] }), cell({ date: "2026-10-28", draft: [] })];
    const now = [cell({ date: "2026-11-03" }), cell({ date: "2026-11-04", live: [] })];
    expect(copyWeek(last, now, [{ from: "2026-10-27", to: "2026-11-03" }, { from: "2026-10-28", to: "2026-11-04" }])).toEqual([
      { staffId: "s1", date: "2026-11-03", shifts: [{ start: h(10), end: h(18) }] },
    ]);
  });

  it("clears every day with hours", () => {
    expect(clearWeek([cell(), cell({ date: "2026-11-04", live: [] }), cell({ date: "2026-11-05", live: [], draft: [nineToFive] })]).map((e) => e.date)).toEqual(["2026-11-03", "2026-11-05"]);
  });

  it("drops a draft that's back to what's published", () => {
    expect(withEdit(cell(), [{ start: h(10), end: h(17) }]).draft).toEqual([{ start: h(10), end: h(17) }]);
    expect(withEdit(cell({ draft: [] }), [nineToFive]).draft).toBeNull();
  });

  it("lists each change with the clients it leaves outside the new hours", () => {
    const booked = [{ appointmentId: "a", client: "Ava Reed", start: h(9), end: h(10) }, { appointmentId: "b", client: "Ben Ito", start: h(15), end: h(16) }];
    const changes = changesOf([cell({ booked, draft: [{ start: h(9), end: h(13) }] }), cell({ date: "2026-11-04" })]);
    expect(changes).toHaveLength(1);
    expect(changes[0].affected.map((b) => b.client)).toEqual(["Ben Ito"]);
    // Someone already booked outside the published hours isn't new.
    const already = cell({ live: [{ start: h(10), end: h(17) }], booked, draft: [{ start: h(10), end: h(14) }] });
    expect(changesOf([already])[0].affected.map((b) => b.client)).toEqual(["Ben Ito"]);
    expect(outside(cell({ booked, timeOff: [{ start: h(14), end: h(17) }] }), [nineToFive]).map((b) => b.client)).toEqual(["Ben Ito"]);
  });

  it("opens the Mark out panel leaving early, or for the day", () => {
    expect(outPanelHref({ staffId: "s1", date: "2026-11-03", before: [nineToFive], after: [{ start: h(9), end: h(13) }] })).toBe("/calendar?date=2026-11-03&out=s1&leaves=13%3A00");
    expect(outPanelHref({ staffId: "s1", date: "2026-11-03", before: [nineToFive], after: [] })).toBe("/calendar?date=2026-11-03&out=s1");
    expect(outPanelHref({ staffId: "s1", date: "2026-11-03", before: [nineToFive], after: [{ start: h(12), end: h(17) }] })).toBe("/calendar?date=2026-11-03&out=s1");
  });
});
