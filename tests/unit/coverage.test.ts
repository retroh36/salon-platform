import { describe, expect, it } from "vitest";
import { coverageFlags, draftMonth, timeOffImpact, whoIsWorking, type CoverageCell, type CoverageDay, type CoveragePerson } from "@/lib/coverage";

const H = (h: number) => h * 60;
const team: CoveragePerson[] = [
  { id: "dan", firstName: "Daniel", role: "manager", level: null, chair: null },
  { id: "sam", firstName: "Sam", role: "front_desk", level: null, chair: null },
  { id: "jo", firstName: "Jordan", role: "front_desk", level: null, chair: null },
  { id: "gil", firstName: "Gil", role: "stylist", level: "master", chair: "Chair 1" },
  { id: "nola", firstName: "Nola", role: "stylist", level: "senior", chair: "Chair 2" },
  { id: "shae", firstName: "Shae", role: "stylist", level: "artisan", chair: "Chair 3" },
];
const cell = (staffId: string, from: number | null, to = 0, more: Partial<CoverageCell> = {}): CoverageCell => ({
  staffId,
  shifts: from == null ? [] : [{ start: H(from), end: H(to) }],
  draft: false,
  timeOff: [],
  clients: 0,
  bookedMinutes: 0,
  lentChair: null,
  ...more,
});
// A Thursday open 9 to 8, fully covered.
const covered = (): CoverageDay => ({
  date: "2026-11-05",
  open: [{ start: H(9), end: H(20) }],
  cells: [cell("dan", 9, 17), cell("sam", 12, 20), cell("jo", null), cell("gil", 9, 17), cell("nola", 12, 20), cell("shae", 9, 17)],
  requests: [],
});

describe("coverage flags", () => {
  it("are none on a covered day, and none when the salon is closed", () => {
    expect(coverageFlags(team, covered())).toEqual([]);
    expect(coverageFlags(team, { ...covered(), open: [], cells: [] })).toEqual([]);
  });

  it("find gaps at the desk and on the floor, and a day with no Master", () => {
    const day = covered();
    day.cells = [cell("dan", 9, 17), cell("sam", null), cell("jo", null), cell("gil", null), cell("nola", 12, 20), cell("shae", 9, 11)];
    expect(coverageFlags(team, day).map((f) => [f.kind, f.text])).toEqual([
      ["desk_gap", "Nobody on the front desk 5pm–8pm on Thu, Nov 5."],
      ["no_stylists", "No stylists working 11am–noon on Thu, Nov 5."],
      ["no_master", "No Master stylist working on Thu, Nov 5."],
    ]);
  });

  it("count approved time off as not working, and ignore gaps under half an hour", () => {
    const day = covered();
    day.cells[1] = cell("sam", 12, 20, { timeOff: [{ start: H(18), end: H(20) }] });
    day.cells[0] = cell("dan", 9, 11.75);
    expect(coverageFlags(team, day).map((f) => f.text)).toEqual(["Nobody on the front desk 6pm–8pm on Thu, Nov 5."]);
  });

  it("find two people on one chair, and draft hours over approved time off", () => {
    const day = covered();
    day.cells[5] = cell("shae", 9, 17, { lentChair: "Chair 2" });
    day.cells[4] = cell("nola", 15, 20, { draft: true, timeOff: [{ start: H(18), end: H(20) }] });
    expect(coverageFlags(team, day).map((f) => [f.kind, f.text])).toEqual([
      ["no_stylists", "No stylists working 6pm–8pm on Thu, Nov 5."],
      ["double_chair", "Nola and Shae are both on Chair 2 3pm–5pm on Thu, Nov 5."],
      ["draft_on_time_off", "Nola's draft hours on Thu, Nov 5 overlap approved time off."],
    ]);
  });

  it("flag a time-off request on a day with the person's clients booked, or a busy day", () => {
    const day = covered();
    day.requests = [{ staffId: "nola", startMinute: null, endMinute: null }];
    day.cells[4] = cell("nola", 12, 20, { clients: 6, bookedMinutes: H(6) });
    expect(coverageFlags(team, day).map((f) => f.text)).toEqual(["Nola asked for time off on Thu, Nov 5, and 6 of Nola's clients are booked then."]);
    // Nobody of theirs booked, but the stylists are 80% booked.
    day.cells = day.cells.map((c) => (c.staffId === "nola" ? { ...c, clients: 0, bookedMinutes: 0 } : ["gil", "shae"].includes(c.staffId) ? { ...c, bookedMinutes: H(10) } : c));
    // 20 of their 24 hours.
    expect(coverageFlags(team, day).map((f) => f.text)).toEqual(["Nola asked for time off on Thu, Nov 5, and the day is already busy."]);
  });
});

describe("questions Denise answers", () => {
  it("who's working Thursday night: hours that reach past 5pm, earliest first", () => {
    expect(whoIsWorking(team, covered(), "evening").map((p) => p.firstName)).toEqual(["Sam", "Nola"]);
    expect(whoIsWorking(team, covered(), "morning").map((p) => p.firstName)).toEqual(["Daniel", "Gil", "Shae"]);
  });

  it("can I give Nola the day off: her clients, who's left, and the gap it opens", () => {
    const day = covered();
    day.cells[4] = cell("nola", 12, 20, { clients: 4, bookedMinutes: H(5) });
    const impact = timeOffImpact(team, day, "nola");
    expect(impact).toMatchObject({ working: true, clients: 4, alsoOff: ["Jordan"], stylistsLeft: 2, mastersLeft: 1 });
    expect(impact.newFlags.map((f) => f.text)).toEqual(["No stylists working 5pm–8pm on Thu, Nov 5."]);
    // Her five booked hours land on the stylists left: 5 of their 16 hours.
    expect(impact.busyShareAfter).toBeCloseTo(5 / 16);
    expect(timeOffImpact(team, day, "jo")).toMatchObject({ working: false, clients: 0, newFlags: [] });
  });
});

describe("drafting a month", () => {
  it("takes out approved time off and fills a desk gap with someone off that day", () => {
    const thursday = covered();
    thursday.cells[1] = cell("sam", null);
    thursday.cells[2] = cell("jo", null, 0, { timeOff: [{ start: 0, end: H(24) }] });
    const friday: CoverageDay = { ...covered(), date: "2026-11-06" };
    friday.cells[1] = cell("sam", 12, 20, { timeOff: [{ start: 0, end: H(24) }] });
    const { changes, filled, left } = draftMonth(team, [
      { ...thursday, weekStart: "2026-11-02" },
      { ...friday, weekStart: "2026-11-02" },
    ]);
    // Thursday: Jordan's off, so Sam covers 5 to 8 (at least four hours: 4 to 8).
    // Friday: Sam's time off becomes a day off, and Jordan covers.
    expect(changes).toEqual([
      { staffId: "sam", date: "2026-11-05", shifts: [{ start: H(16), end: H(20) }] },
      { staffId: "sam", date: "2026-11-06", shifts: [] },
      { staffId: "jo", date: "2026-11-06", shifts: [{ start: H(16), end: H(20) }] },
    ]);
    expect(filled.map((f) => f.text)).toEqual(["Sam covers the front desk 4pm–8pm on Thu, Nov 5.", "Jordan covers the front desk 4pm–8pm on Fri, Nov 6."]);
    expect(left).toEqual([]);
  });

  it("never takes anyone past 40 hours a week, and leaves the gap when nobody can cover", () => {
    // Monday to Thursday, Sam and Jordan take turns on 19-hour days (38
    // hours each); on Friday both are off, and four more hours would be 42.
    const week = [2, 3, 4, 5, 6].map((d, i) => {
      const day = covered();
      day.date = `2026-11-0${d}`;
      day.cells[0] = cell("dan", 9, 17);
      day.cells[1] = cell("sam", i < 4 && i % 2 === 0 ? 0 : null, 19);
      day.cells[2] = cell("jo", i < 4 && i % 2 === 1 ? 0 : null, 19);
      return { ...day, weekStart: "2026-11-02" };
    });
    const { filled, left } = draftMonth(team, week);
    expect(filled).toEqual([]);
    expect(left.filter((f) => f.kind === "desk_gap").map((f) => f.text)).toContain("Nobody on the front desk 5pm–8pm on Fri, Nov 6.");
  });
});
