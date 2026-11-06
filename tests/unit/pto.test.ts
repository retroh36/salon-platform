import { describe, expect, it } from "vitest";
import { formatPto, minutesOff, periodEndsBetween, ptoStatement, yearStartOf, type PtoPolicy } from "@/lib/pto";
import { addDays } from "@/lib/scheduling/time";
import { offFacts, ptoFacts, takenByType } from "@/lib/denise/pto";
import type { TimeOffStretch } from "@/lib/pto-load";

const HR = 60;
const policy = (more: Partial<PtoPolicy> = {}): PtoPolicy => ({
  accrual: "yearly",
  yearlyMinutes: 80 * HR,
  prorateFirstYear: true,
  earnMinutes: 60,
  perHours: 30,
  periodMinutes: 4 * HR,
  yearStartMonth: 1,
  carryOver: "up_to",
  carryMinutes: 40 * HR,
  capMinutes: null,
  trackingFrom: "2025-01-01",
  ...more,
});
const none = { worked: new Map<string, number>(), periodEnds: [], uses: [], pending: [], adjustments: [] };

describe("the PTO year", () => {
  it("starts on the 1st of the salon's month", () => {
    expect(yearStartOf("2026-11-06", 1)).toBe("2026-01-01");
    expect(yearStartOf("2026-03-15", 4)).toBe("2025-04-01");
    expect(yearStartOf("2026-04-01", 4)).toBe("2026-04-01");
  });
});

describe("a yearly amount", () => {
  it("is granted at the start of each year, prorated for someone who starts partway through", () => {
    const s = ptoStatement(policy(), { ...none, startsOn: "2025-07-02" }, "2025-12-31");
    // 183 of 365 days left: 40.1 hr, to the quarter hour.
    expect(s.lines).toEqual([{ date: "2025-07-02", kind: "granted", minutes: 2400, balance: 2400, note: "For the rest of the year (80 hr a year)" }]);
    expect(ptoStatement(policy({ prorateFirstYear: false }), { ...none, startsOn: "2025-07-02" }, "2025-12-31").balance).toBe(80 * HR);
  });

  it("carries over up to the limit at the year's end, then grants the new year", () => {
    const s = ptoStatement(policy(), { ...none, startsOn: "2025-01-01", uses: [{ date: "2025-03-03", minutes: 8 * HR, label: "Vacation" }] }, "2026-01-02");
    expect(s.lines.map((l) => [l.date, l.kind, l.minutes / HR, l.balance / HR])).toEqual([
      ["2025-01-01", "granted", 80, 80],
      ["2025-03-03", "used", -8, 72],
      ["2026-01-01", "lost", -32, 40],
      ["2026-01-01", "granted", 80, 120],
    ]);
    expect(s.carriedIn).toBe(40 * HR);
    expect(s.earnedThisYear).toBe(80 * HR);
  });

  it("keeps everything or nothing as the policy says", () => {
    expect(ptoStatement(policy({ carryOver: "all" }), { ...none, startsOn: "2025-01-01" }, "2026-01-01").balance).toBe(160 * HR);
    expect(ptoStatement(policy({ carryOver: "none" }), { ...none, startsOn: "2025-01-01" }, "2026-01-01").balance).toBe(80 * HR);
  });

  it("stops at the cap", () => {
    const s = ptoStatement(policy({ carryOver: "all", capMinutes: 100 * HR }), { ...none, startsOn: "2025-01-01" }, "2026-01-01");
    expect(s.balance).toBe(100 * HR);
    expect(s.lines.at(-1)!.note).toBe("The year's 80 hr (at the cap)");
  });
});

describe("per hour worked", () => {
  it("earns as they work, a line a month", () => {
    const worked = new Map<string, number>();
    for (let d = "2026-01-05"; d <= "2026-02-27"; d = addDays(d, 1)) worked.set(d, 8 * HR);
    const s = ptoStatement(policy({ accrual: "per_hour" }), { ...none, worked, startsOn: "2026-01-01" }, "2026-02-27");
    // 27 days in January at 8 hr is 216 hr worked, so 7.2 hr earned.
    expect(s.lines.map((l) => [l.date, l.kind, Math.round(l.minutes), l.note])).toEqual([
      ["2026-01-31", "earned", 432, "For 216 hr worked"],
      ["2026-02-27", "earned", 432, "For 216 hr worked"],
    ]);
  });
});

describe("per pay period", () => {
  it("earns at the end of each period", () => {
    const periodOf = (d: string) => {
      const day = Number(d.slice(8));
      return day <= 15 ? { from: `${d.slice(0, 8)}01`, to: `${d.slice(0, 8)}15` } : { from: `${d.slice(0, 8)}16`, to: addDays(`${d.slice(0, 7)}-01`.replace(/-(\d\d)-01$/, (_, m) => `-${String(Number(m) + 1).padStart(2, "0")}-01`), -1) };
    };
    const ends = periodEndsBetween("2026-01-01", "2026-02-20", periodOf);
    expect(ends).toEqual(["2026-01-15", "2026-01-31", "2026-02-15"]);
    expect(ptoStatement(policy({ accrual: "per_period" }), { ...none, periodEnds: ends, startsOn: "2026-01-01" }, "2026-02-20").balance).toBe(12 * HR);
  });
});

describe("booked, waiting and adjusted", () => {
  it("counts time off to come apart from the balance, and adjustments on their day", () => {
    const s = ptoStatement(
      policy({ prorateFirstYear: false }),
      {
        ...none,
        startsOn: "2026-01-01",
        uses: [
          { date: "2026-02-02", minutes: 8 * HR, label: "Vacation" },
          { date: "2026-12-01", minutes: 16 * HR, label: "Vacation" },
        ],
        pending: [{ date: "2026-12-10", minutes: 4 * HR, label: "Personal" }],
        adjustments: [{ date: "2025-12-31", minutes: 10 * HR, reason: "Starting balance" }],
      },
      "2026-11-06",
    );
    expect(s.balance).toBe(82 * HR);
    expect(s.booked).toBe(16 * HR);
    expect(s.pending).toBe(4 * HR);
    expect(s.available).toBe(66 * HR);
    // An adjustment dated before tracking starts counts on its first day.
    expect(s.lines[0]).toMatchObject({ date: "2026-01-01", kind: "adjusted", note: "Starting balance" });
  });
});

describe("hours a day of time off takes", () => {
  const hours = [
    { start: 9 * HR, end: 13 * HR },
    { start: 14 * HR, end: 18 * HR },
  ];
  it("is their working hours, or the part it covers", () => {
    expect(minutesOff(hours, { startsOn: "2026-11-02", endsOn: "2026-11-03", startMinute: null, endMinute: null }, "2026-11-03")).toBe(8 * HR);
    expect(minutesOff(hours, { startsOn: "2026-11-03", endsOn: "2026-11-03", startMinute: 12 * HR, endMinute: 15 * HR }, "2026-11-03")).toBe(2 * HR);
    expect(minutesOff([], { startsOn: "2026-11-03", endsOn: "2026-11-03", startMinute: null, endMinute: null }, "2026-11-03")).toBe(0);
  });

  it("reads in hours", () => {
    expect(formatPto(480)).toBe("8 hr");
    expect(formatPto(750)).toBe("12.5 hr");
    expect(formatPto(-240)).toBe("-4 hr");
  });
});

describe("what Denise is told", () => {
  const say = (d: string) => `day ${d}`;
  const stretch = (more: Partial<TimeOffStretch>): TimeOffStretch => ({
    staffId: "nola",
    firstName: "Nola",
    type: { id: "sick", name: "Sick", reason: "sick", usesPto: false, archived: false },
    status: "approved",
    startsOn: "2026-04-07",
    endsOn: "2026-04-08",
    startMinute: null,
    endMinute: null,
    days: [
      { date: "2026-04-07", minutes: 8 * HR },
      { date: "2026-04-08", minutes: 8 * HR },
    ],
    ...more,
  });

  it("counts whole days, part days and hours by type", () => {
    const part = stretch({ startsOn: "2026-06-02", endsOn: "2026-06-02", startMinute: 9 * HR, endMinute: 12 * HR, days: [{ date: "2026-06-02", minutes: 3 * HR }] });
    expect(takenByType([stretch({}), part])).toEqual([{ type: "Sick", uses_pto: false, days: 2, part_days: 1, hours: "19 hr" }]);
  });

  it("gives the balance when PTO is tracked, what's been taken this year, and what's coming up", () => {
    const statement = ptoStatement(policy({ prorateFirstYear: false }), { ...none, startsOn: "2026-01-01" }, "2026-11-06");
    const ahead = stretch({ type: { id: "v", name: "Vacation", reason: "vacation", usesPto: true, archived: false }, status: "requested", startsOn: "2026-12-01", endsOn: "2026-12-01", days: [{ date: "2026-12-01", minutes: 8 * HR }] });
    const facts = ptoFacts({ firstName: "Nola" }, statement, [stretch({}), ahead], { since: "2026-01-01", today: "2026-11-06", say });
    expect(facts.pto).toMatchObject({ balance: "80 hr", left_to_ask_for: "80 hr" });
    expect(facts.taken_by_type).toEqual([{ type: "Sick", uses_pto: false, days: 2, part_days: 0, hours: "16 hr" }]);
    expect(facts.coming_up).toEqual([{ type: "Vacation", when: "day 2026-12-01", status: "asked for, waiting" }]);
    expect(ptoFacts({ firstName: "Nola" }, null, [], { since: "2026-01-01", today: "2026-11-06", say }).pto).toBe("The salon doesn't track PTO in Maestra.");
  });

  it("lists who's off, leaving out days nobody was working", () => {
    const facts = offFacts([stretch({}), stretch({ firstName: "Lois", days: [] })], { from: "2026-04-06", to: "2026-04-12", say });
    expect(facts.off).toEqual([{ first_name: "Nola", type: "Sick", when: "day 2026-04-07 to day 2026-04-08", working_days_off_in_range: 2, status: "approved" }]);
    expect(offFacts([], { from: "2026-04-06", to: "2026-04-12", say }).note).toBe("Nobody has time off then.");
  });
});
