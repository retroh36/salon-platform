import { describe, expect, it } from "vitest";
import { hourlyPay, periodContaining, scheduledMinutes } from "@/lib/payroll";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, daysBetween, fromLocal, shiftStart, todayIn, toLocal } from "@/lib/scheduling/time";

// The two daylight saving changes around now, in Chicago: clocks go back on
// Sun Nov 1 2026 (a 25-hour day) and forward on Sun Mar 14 2027 (23 hours).
// Wall-clock schedules stay put and days are whole local days on both.
const CHICAGO = "America/Chicago";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

describe("the day the clocks change", () => {
  it("is 25 hours in the fall and 23 in the spring, from local midnight to midnight", () => {
    expect(hoursBetween(startOfLocalDay("2026-11-01", CHICAGO), startOfLocalDay("2026-11-02", CHICAGO))).toBe(25);
    expect(hoursBetween(startOfLocalDay("2027-03-14", CHICAGO), startOfLocalDay("2027-03-15", CHICAGO))).toBe(23);
    expect(hoursBetween(startOfLocalDay("2026-10-31", CHICAGO), startOfLocalDay("2026-11-01", CHICAGO))).toBe(24);
  });

  it("puts a 9am shift at 9am on both sides", () => {
    for (const date of ["2026-10-31", "2026-11-01", "2026-11-02", "2027-03-13", "2027-03-14", "2027-03-15"]) {
      expect(toLocal(fromLocal(date, h(9), CHICAGO)!, CHICAGO)).toEqual({ date, minute: h(9) });
    }
    // 9am is 14:00 UTC before the fall change and 15:00 after it.
    expect(fromLocal("2026-10-31", h(9), CHICAGO)!.toISOString()).toBe("2026-10-31T14:00:00.000Z");
    expect(fromLocal("2026-11-01", h(9), CHICAGO)!.toISOString()).toBe("2026-11-01T15:00:00.000Z");
    expect(fromLocal("2027-03-14", h(9), CHICAGO)!.toISOString()).toBe("2027-03-14T14:00:00.000Z");
  });

  it("knows which day it is at the salon either side of midnight", () => {
    // 11:30pm Sat Oct 31 local (CDT, UTC-5), then 12:30am Sun Nov 1.
    expect(todayIn(CHICAGO, new Date("2026-11-01T04:30:00Z"))).toBe("2026-10-31");
    expect(todayIn(CHICAGO, new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    // 11:30pm Sun Nov 1 (CST now, UTC-6) is still Nov 1, though it's Nov 2 in UTC.
    expect(todayIn(CHICAGO, new Date("2026-11-02T05:30:00Z"))).toBe("2026-11-01");
    expect(todayIn(CHICAGO, new Date("2027-03-15T04:30:00Z"))).toBe("2027-03-14");
  });
});

describe("moving a visit across the change", () => {
  it("keeps 2pm at 2pm a week later, though that's an hour later in UTC", () => {
    const before = fromLocal("2026-10-28", h(14), CHICAGO)!;
    const after = shiftStart(before, CHICAGO, 7, 0)!;
    expect(toLocal(after, CHICAGO)).toEqual({ date: "2026-11-04", minute: h(14) });
    expect(hoursBetween(before, after)).toBe(7 * 24 + 1);
    expect(daysBetween("2026-10-28", "2026-11-04")).toBe(7);
    const spring = shiftStart(fromLocal("2027-03-10", h(14), CHICAGO)!, CHICAGO, 7, 0)!;
    expect(toLocal(spring, CHICAGO)).toEqual({ date: "2027-03-17", minute: h(14) });
  });

  it("refuses a time the spring change skips, rather than landing an hour off", () => {
    expect(shiftStart(fromLocal("2027-03-13", h(2, 30), CHICAGO)!, CHICAGO, 1, 0)).toBeNull();
  });

  it("counts whole days across both changes", () => {
    expect(addDays("2027-03-13", 2)).toBe("2027-03-15");
    expect(daysBetween("2026-10-25", "2027-03-21")).toBe(147);
  });
});

describe("pay over the change", () => {
  // Nine to five every day.
  const allWeek = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((w) => [w, [{ start: h(9), end: h(17) }]]));
  const schedule = { weekly: allWeek, overrides: {}, timeOff: [] };

  it("pays the shift worked, not the length of the day", () => {
    expect(scheduledMinutes(schedule, "2026-11-01", "2026-11-01")).toBe(h(8));
    expect(scheduledMinutes(schedule, "2027-03-14", "2027-03-14")).toBe(h(8));
    expect(hourlyPay(schedule, "2026-10-26", "2026-11-01", [{ from: null, hourlyRateCents: 2000 }])).toEqual({ minutes: 7 * h(8), payCents: 7 * 8 * 2000, rates: [2000] });
  });

  it("keeps a weekly pay period Monday to Sunday across the change", () => {
    const p = periodContaining("weekly", "2026-10-26", "2026-11-01");
    expect(p).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(periodContaining("weekly", "2026-10-26", "2026-11-02")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
  });
});
