import { describe, expect, it } from "vitest";
import {
  addDays,
  containsSpan,
  daysBetween,
  shiftStart,
  datesBetween,
  dayView,
  formatMinute,
  fromLocal,
  intersectIntervals,
  isAvailable,
  isLocalDate,
  mergeIntervals,
  minuteToTime,
  overlapsSpan,
  parseTime,
  startOfWeek,
  subtractIntervals,
  toLocal,
  validateIntervals,
  weekdayOf,
  type LocationSchedule,
  type StaffSchedule,
} from "@/lib/scheduling";

const CHICAGO = "America/Chicago";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const span = (from: number, to: number) => ({ start: from, end: to });

// Chicago instant for a local wall time (test helper; asserts it exists).
function at(date: string, time: string, tz = CHICAGO): Date {
  const instant = fromLocal(date, parseTime(time)!, tz);
  if (!instant) throw new Error(`${date} ${time} doesn't exist in ${tz}`);
  return instant;
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

describe("local dates", () => {
  it("gives ISO weekdays", () => {
    expect(weekdayOf("2026-10-19")).toBe(1); // Monday
    expect(weekdayOf("2026-10-21")).toBe(3);
    expect(weekdayOf("2026-10-25")).toBe(7); // Sunday
    expect(weekdayOf("2028-02-29")).toBe(2); // leap day
  });

  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the Monday of a week", () => {
    expect(startOfWeek("2026-10-21")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-19")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19"); // Sunday belongs to the week before
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
  });

  it("lists dates inclusively", () => {
    expect(datesBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(datesBetween("2026-10-30", "2026-10-30")).toEqual(["2026-10-30"]);
  });

  it("validates dates", () => {
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("26-1-1")).toBe(false);
  });
});

describe("times of day", () => {
  it("parses and formats", () => {
    expect(parseTime("09:30")).toBe(570);
    expect(parseTime("9:30")).toBe(570);
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("24:00")).toBe(1440);
    for (const bad of ["24:30", "9:60", "930", "", "noon"]) expect(parseTime(bad)).toBeNull();
    expect(minuteToTime(570)).toBe("09:30");
    expect(minuteToTime(1440)).toBe("24:00");
  });

  it("formats for people", () => {
    expect(formatMinute(h(9))).toBe("9am");
    expect(formatMinute(h(13, 30))).toBe("1:30pm");
    expect(formatMinute(h(12))).toBe("noon");
    expect(formatMinute(h(0, 15))).toBe("12:15am");
    expect(formatMinute(h(24))).toBe("midnight");
  });
});

describe("moving to another day", () => {
  it("counts days between dates, and shifts a start in local time across daylight saving", () => {
    expect(daysBetween("2026-10-27", "2026-11-03")).toBe(7);
    expect(daysBetween("2026-11-03", "2026-10-27")).toBe(-7);
    // 2pm on Tue, Oct 27 (daylight time) to 2pm a week later (standard time).
    const start = fromLocal("2026-10-27", h(14), CHICAGO)!;
    expect(toLocal(shiftStart(start, CHICAGO, 7, 0)!, CHICAGO)).toEqual({ date: "2026-11-03", minute: h(14) });
    expect(toLocal(shiftStart(start, CHICAGO, 1, 60)!, CHICAGO)).toEqual({ date: "2026-10-28", minute: h(15) });
    // Not past midnight.
    expect(shiftStart(start, CHICAGO, 0, h(11))).toBeNull();
  });
});

describe("timezones", () => {
  it("converts an instant to local wall time", () => {
    // 15:00 UTC is 10:00 in Chicago during daylight time (UTC-5)...
    expect(toLocal(new Date("2026-10-21T15:00:00Z"), CHICAGO)).toEqual({ date: "2026-10-21", minute: h(10) });
    // ...and 9:00 in standard time (UTC-6).
    expect(toLocal(new Date("2026-12-01T15:00:00Z"), CHICAGO)).toEqual({ date: "2026-12-01", minute: h(9) });
    // Late evening UTC can still be the previous day locally.
    expect(toLocal(new Date("2026-10-22T03:30:00Z"), CHICAGO)).toEqual({ date: "2026-10-21", minute: h(22, 30) });
  });

  it("converts local wall time to an instant", () => {
    expect(fromLocal("2026-10-21", h(10), CHICAGO)?.toISOString()).toBe("2026-10-21T15:00:00.000Z");
    expect(fromLocal("2026-12-01", h(9), CHICAGO)?.toISOString()).toBe("2026-12-01T15:00:00.000Z");
    expect(fromLocal("2026-10-21", h(9), "Asia/Tokyo")?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(fromLocal("2026-10-21", 0, "UTC")?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
  });

  it("keeps a 9am shift at 9am on both sides of a clock change", () => {
    // Spring forward: Mar 8, 2026. Fall back: Nov 1, 2026.
    for (const date of ["2026-03-07", "2026-03-09", "2026-10-31", "2026-11-02"]) {
      expect(toLocal(fromLocal(date, h(9), CHICAGO)!, CHICAGO)).toEqual({ date, minute: h(9) });
    }
  });

  it("returns null for a time skipped when clocks go forward", () => {
    expect(fromLocal("2026-03-08", h(2, 30), CHICAGO)).toBeNull();
    expect(fromLocal("2026-03-08", h(3), CHICAGO)?.toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });

  it("returns the first of a time repeated when clocks go back", () => {
    // 1:30am happens at 06:30Z (daylight) and again at 07:30Z (standard).
    expect(fromLocal("2026-11-01", h(1, 30), CHICAGO)?.toISOString()).toBe("2026-11-01T06:30:00.000Z");
    expect(toLocal(new Date("2026-11-01T07:30:00Z"), CHICAGO)).toEqual({ date: "2026-11-01", minute: h(1, 30) });
  });

  it("round-trips every 5 minutes of a clock-change day", () => {
    for (const date of ["2026-03-08", "2026-11-01"]) {
      for (let minute = 0; minute < 1440; minute += 5) {
        const instant = fromLocal(date, minute, CHICAGO);
        if (instant) expect(toLocal(instant, CHICAGO)).toEqual({ date, minute });
        else expect(date === "2026-03-08" && minute >= h(2) && minute < h(3)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

describe("intervals", () => {
  it("merges overlapping and touching intervals", () => {
    expect(mergeIntervals([span(h(14), h(18)), span(h(9), h(13)), span(h(12), h(14))])).toEqual([span(h(9), h(18))]);
    expect(mergeIntervals([span(h(9), h(12)), span(h(13), h(17))])).toEqual([span(h(9), h(12)), span(h(13), h(17))]);
  });

  it("intersects", () => {
    const staff = [span(h(8), h(13)), span(h(14), h(21))];
    const open = [span(h(9), h(20))];
    expect(intersectIntervals(staff, open)).toEqual([span(h(9), h(13)), span(h(14), h(20))]);
    expect(intersectIntervals(staff, [])).toEqual([]);
  });

  it("subtracts, splitting where needed", () => {
    expect(subtractIntervals([span(h(9), h(17))], [span(h(12), h(13))])).toEqual([span(h(9), h(12)), span(h(13), h(17))]);
    expect(subtractIntervals([span(h(9), h(17))], [span(h(8), h(10)), span(h(16), h(18))])).toEqual([span(h(10), h(16))]);
    expect(subtractIntervals([span(h(9), h(17))], [span(0, 1440)])).toEqual([]);
    expect(subtractIntervals([span(h(9), h(12))], [span(h(13), h(14))])).toEqual([span(h(9), h(12))]);
  });

  it("checks containment and overlap at the edges", () => {
    const hours = [span(h(9), h(13)), span(h(14), h(18))];
    expect(containsSpan(hours, h(9), h(13))).toBe(true);
    expect(containsSpan(hours, h(12), h(14))).toBe(false); // spans the lunch break
    expect(containsSpan([span(h(9), h(12)), span(h(12), h(17))], h(11), h(13))).toBe(true); // touching shifts join
    expect(overlapsSpan([span(h(12), h(13))], h(11), h(12))).toBe(false); // ends exactly as it starts
    expect(overlapsSpan([span(h(12), h(13))], h(11), h(12, 5))).toBe(true);
  });

  it("validates a day's intervals", () => {
    expect(validateIntervals([span(h(9), h(13)), span(h(13), h(18))])).toBeNull();
    expect(validateIntervals([])).toBeNull();
    expect(validateIntervals([span(h(9), h(13)), span(h(12), h(18))])).toBe("overlapping");
    expect(validateIntervals([span(h(13), h(9))])).toBe("start_not_before_end");
    expect(validateIntervals([span(h(9), h(9))])).toBe("start_not_before_end");
    expect(validateIntervals([span(h(9, 2), h(10))])).toBe("not_five_minute_steps");
    expect(validateIntervals([span(-5, h(10))])).toBe("invalid_time");
    expect(validateIntervals([span(h(9), 1445)])).toBe("invalid_time");
  });
});

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

// Open Tue-Sat; Tue/Wed 9-7, Thu/Fri 9-8, Sat 8-5. Closed Sun/Mon.
const salon: LocationSchedule = {
  timeZone: CHICAGO,
  weekly: {
    2: [span(h(9), h(19))],
    3: [span(h(9), h(19))],
    4: [span(h(9), h(20))],
    5: [span(h(9), h(20))],
    6: [span(h(8), h(17))],
  },
};

// Tue/Wed split shift 9-1 and 2-6; Thu 12-8; Sat 7am-2pm (starts before opening).
function stylist(extra: Partial<StaffSchedule> = {}): StaffSchedule {
  return {
    weekly: {
      2: [span(h(9), h(13)), span(h(14), h(18))],
      3: [span(h(9), h(13)), span(h(14), h(18))],
      4: [span(h(12), h(20))],
      6: [span(h(7), h(14))],
    },
    overrides: {},
    timeOff: [],
    ...extra,
  };
}

// Wed 2026-10-21, Thu 10-22, Fri 10-23, Sat 10-24, Sun 10-25, Mon 10-26.
describe("isAvailable", () => {
  it("is available inside a shift, including exactly to its end", () => {
    expect(isAvailable(stylist(), salon, at("2026-10-21", "09:00"), 60)).toEqual({ available: true });
    expect(isAvailable(stylist(), salon, at("2026-10-21", "12:00"), 60)).toEqual({ available: true });
    expect(isAvailable(stylist(), salon, at("2026-10-21", "17:00"), 60)).toEqual({ available: true });
  });

  it("respects split shifts", () => {
    // 12:30 + 60 runs into the 1-2pm break.
    expect(isAvailable(stylist(), salon, at("2026-10-21", "12:30"), 60)).toEqual({ available: false, reason: "not_working" });
    expect(isAvailable(stylist(), salon, at("2026-10-21", "13:30"), 30)).toEqual({ available: false, reason: "not_working" });
    expect(isAvailable(stylist(), salon, at("2026-10-21", "14:00"), 240)).toEqual({ available: true });
    expect(isAvailable(stylist(), salon, at("2026-10-21", "14:00"), 245)).toEqual({ available: false, reason: "not_working" });
  });

  it("is unavailable on days off and before or after hours", () => {
    expect(isAvailable(stylist(), salon, at("2026-10-23", "10:00"), 60)).toEqual({ available: false, reason: "not_working" }); // Friday
    expect(isAvailable(stylist(), salon, at("2026-10-22", "11:00"), 60)).toEqual({ available: false, reason: "not_working" }); // Thu starts 12
    expect(isAvailable(stylist(), salon, at("2026-10-22", "19:30"), 30)).toEqual({ available: true });
  });

  it("is unavailable when the location is closed, even within the stylist's hours", () => {
    // Saturday: works from 7, salon opens at 8.
    expect(isAvailable(stylist(), salon, at("2026-10-24", "07:00"), 60)).toEqual({ available: false, reason: "location_closed" });
    expect(isAvailable(stylist(), salon, at("2026-10-24", "08:00"), 60)).toEqual({ available: true });
    // Monday: closed.
    const mondays = stylist({ weekly: { 1: [span(h(9), h(17))] } });
    expect(isAvailable(mondays, salon, at("2026-10-26", "10:00"), 60)).toEqual({ available: false, reason: "location_closed" });
  });

  it("uses a one-off change instead of the weekly hours that day", () => {
    const lateWednesday = stylist({ overrides: { "2026-10-21": [span(h(12), h(19))] } });
    expect(isAvailable(lateWednesday, salon, at("2026-10-21", "09:00"), 60)).toEqual({ available: false, reason: "not_working" });
    expect(isAvailable(lateWednesday, salon, at("2026-10-21", "13:00"), 60)).toEqual({ available: true }); // was the lunch break
    expect(isAvailable(lateWednesday, salon, at("2026-10-21", "18:00"), 60)).toEqual({ available: true });
    // The next Wednesday is back to normal.
    expect(isAvailable(lateWednesday, salon, at("2026-10-28", "09:00"), 60)).toEqual({ available: true });
  });

  it("lets a one-off change add a day that's normally off", () => {
    const coverFriday = stylist({ overrides: { "2026-10-23": [span(h(10), h(16))] } });
    expect(isAvailable(coverFriday, salon, at("2026-10-23", "10:00"), 60)).toEqual({ available: true });
  });

  it("blocks whole days of approved time off, across a range", () => {
    const vacation = stylist({
      timeOff: [{ startsOn: "2026-10-21", endsOn: "2026-10-24", status: "approved", reason: "vacation" }],
    });
    for (const [date, time] of [["2026-10-21", "09:00"], ["2026-10-22", "12:00"], ["2026-10-24", "08:00"]]) {
      expect(isAvailable(vacation, salon, at(date, time), 30)).toEqual({ available: false, reason: "time_off" });
    }
    // The day after it ends.
    expect(isAvailable(vacation, salon, at("2026-10-27", "09:00"), 30)).toEqual({ available: true });
  });

  it("blocks only the hours of part-day time off", () => {
    const dentist = stylist({
      timeOff: [{ startsOn: "2026-10-22", endsOn: "2026-10-22", startMinute: h(14), endMinute: h(16), status: "approved" }],
    });
    expect(isAvailable(dentist, salon, at("2026-10-22", "12:00"), 120)).toEqual({ available: true }); // ends at 2
    expect(isAvailable(dentist, salon, at("2026-10-22", "13:30"), 60)).toEqual({ available: false, reason: "time_off" });
    expect(isAvailable(dentist, salon, at("2026-10-22", "15:55"), 30)).toEqual({ available: false, reason: "time_off" });
    expect(isAvailable(dentist, salon, at("2026-10-22", "16:00"), 60)).toEqual({ available: true });
  });

  it("ignores requested and declined time off", () => {
    for (const status of ["requested", "declined"] as const) {
      const pending = stylist({ timeOff: [{ startsOn: "2026-10-21", endsOn: "2026-10-21", status }] });
      expect(isAvailable(pending, salon, at("2026-10-21", "09:00"), 60)).toEqual({ available: true });
    }
  });

  it("time off wins over a one-off change", () => {
    const both = stylist({
      overrides: { "2026-10-21": [span(h(12), h(19))] },
      timeOff: [{ startsOn: "2026-10-21", endsOn: "2026-10-21", status: "approved" }],
    });
    expect(isAvailable(both, salon, at("2026-10-21", "13:00"), 60)).toEqual({ available: false, reason: "time_off" });
  });

  it("rejects bad durations and spans past midnight", () => {
    expect(isAvailable(stylist(), salon, at("2026-10-21", "09:00"), 0)).toEqual({ available: false, reason: "invalid_duration" });
    expect(isAvailable(stylist(), salon, at("2026-10-21", "09:00"), 1.5)).toEqual({ available: false, reason: "invalid_duration" });
    expect(isAvailable(stylist(), salon, at("2026-10-21", "23:30"), 60)).toEqual({ available: false, reason: "crosses_midnight" });
  });

  it("uses the location's local time, not the server's or UTC", () => {
    // 14:00Z on a Wednesday is 9:00 in Chicago (daylight time): available.
    expect(isAvailable(stylist(), salon, new Date("2026-10-21T14:00:00Z"), 60)).toEqual({ available: true });
    // 13:00Z is 8:00 in Chicago: before the shift.
    expect(isAvailable(stylist(), salon, new Date("2026-10-21T13:00:00Z"), 60)).toEqual({ available: false, reason: "location_closed" });
    // Same salon schedule in Tokyo: 00:00Z is 9:00 local.
    const tokyo = { ...salon, timeZone: "Asia/Tokyo" };
    expect(isAvailable(stylist(), tokyo, new Date("2026-10-21T00:00:00Z"), 60)).toEqual({ available: true });
  });

  it("keeps shifts at the same wall-clock time after the clocks change", () => {
    // Tuesday Nov 3, 2026 is standard time: 9:00 Chicago = 15:00Z.
    expect(isAvailable(stylist(), salon, new Date("2026-11-03T15:00:00Z"), 60)).toEqual({ available: true });
    expect(isAvailable(stylist(), salon, new Date("2026-11-03T14:00:00Z"), 60)).toEqual({ available: false, reason: "location_closed" });
  });
});

describe("dayView", () => {
  it("summarizes a normal day", () => {
    expect(dayView(stylist(), salon, "2026-10-21")).toEqual({
      date: "2026-10-21",
      weekday: 3,
      open: [span(h(9), h(19))],
      hours: [span(h(9), h(13)), span(h(14), h(18))],
      changed: false,
      timeOff: [],
      available: [span(h(9), h(13)), span(h(14), h(18))],
    });
  });

  it("clips hours to opening hours and removes approved time off", () => {
    const sat = dayView(
      stylist({ timeOff: [{ startsOn: "2026-10-24", endsOn: "2026-10-24", startMinute: h(10), endMinute: h(11), status: "approved" }] }),
      salon,
      "2026-10-24",
    );
    expect(sat.hours).toEqual([span(h(7), h(14))]);
    expect(sat.available).toEqual([span(h(8), h(10)), span(h(11), h(14))]);
  });

  it("shows pending requests without blocking time", () => {
    const view = dayView(stylist({ timeOff: [{ startsOn: "2026-10-20", endsOn: "2026-10-23", status: "requested" }] }), salon, "2026-10-21");
    expect(view.timeOff).toHaveLength(1);
    expect(view.available).toEqual(view.hours);
  });

  it("marks one-off changes", () => {
    const view = dayView(stylist({ overrides: { "2026-10-23": [span(h(10), h(16))] } }), salon, "2026-10-23");
    expect(view).toMatchObject({ changed: true, hours: [span(h(10), h(16))], available: [span(h(10), h(16))] });
  });
});
