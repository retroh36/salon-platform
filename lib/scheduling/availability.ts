// Is a staff member available at a given time?
//
// The single source of truth for working hours; the calendar, online booking
// and the AI scheduler all build on this. Pure functions over data loaded by
// ./load.ts, so they're easy to test.
//
// A staff member is available for [start, start + duration) when, on that
// local date:
//   1. the location is open for the whole span,
//   2. it falls within one of their working intervals (the date's published
//      change if there is one, a day off included, otherwise their repeating
//      pattern for that week), and
//   3. it doesn't overlap approved time off.
// Requested and declined time off don't block anything. Existing
// appointments are the booking engine's concern, not this module's.

import { containsSpan, intersectIntervals, mergeIntervals, overlapsSpan, subtractIntervals, type Interval } from "./intervals.ts";
import { daysBetween, MINUTES_PER_DAY, startOfWeek, toLocal, weekdayOf, type LocalDate, type Weekday } from "./time.ts";

export type WeeklyHours = Partial<Record<Weekday, Interval[]>>;

export type TimeOffStatus = "requested" | "approved" | "declined";

export type TimeOff = {
  id?: string;
  startsOn: LocalDate;
  endsOn: LocalDate; // inclusive
  // Part of a single day; omitted for whole days.
  startMinute?: number | null;
  endMinute?: number | null;
  status: TimeOffStatus;
  reason?: string;
  note?: string | null;
};

export type StaffSchedule = {
  // Their weekly hours (the pattern's first week when it repeats over
  // several).
  weekly: WeeklyHours;
  // A pattern over 2 to 4 weeks ("every other Saturday off"): week `n` of
  // the cycle is `weeks[n]`, counted from the week of `startsOn`.
  cycle?: { startsOn: LocalDate; weeks: WeeklyHours[] } | null;
  // One-off changes: on these dates, these hours replace the pattern (an
  // empty list is a day off).
  overrides: Record<LocalDate, Interval[]>;
  timeOff: TimeOff[];
};

// Which week of a repeating pattern a date falls in.
export function cycleWeek(cycle: { startsOn: LocalDate; weeks: readonly unknown[] }, date: LocalDate): number {
  const n = cycle.weeks.length;
  const weeks = Math.floor(daysBetween(startOfWeek(cycle.startsOn), startOfWeek(date)) / 7);
  return ((weeks % n) + n) % n;
}

// Their repeating pattern's hours on a date.
export function patternHours(staff: Pick<StaffSchedule, "weekly" | "cycle">, date: LocalDate): Interval[] {
  const weekly = staff.cycle && staff.cycle.weeks.length > 1 ? staff.cycle.weeks[cycleWeek(staff.cycle, date)] : staff.weekly;
  return weekly[weekdayOf(date)] ?? [];
}

// Their hours on a date: the one-off change, else the pattern.
export function hoursOn(staff: Pick<StaffSchedule, "weekly" | "cycle" | "overrides">, date: LocalDate): Interval[] {
  return mergeIntervals(staff.overrides[date] ?? patternHours(staff, date));
}

export type LocationSchedule = {
  timeZone: string;
  weekly: WeeklyHours;
};

export type DayView = {
  date: LocalDate;
  weekday: Weekday;
  // When the location is open.
  open: Interval[];
  // The staff member's hours that day: the one-off change, or weekly hours.
  hours: Interval[];
  changed: boolean;
  // All time off touching the date, any status (for display).
  timeOff: TimeOff[];
  // Bookable time: hours, within opening hours, minus approved time off.
  available: Interval[];
};

export type Unavailable = "location_closed" | "not_working" | "time_off" | "invalid_duration" | "crosses_midnight";

export type Availability = { available: true } | { available: false; reason: Unavailable };

// The part of the day a time-off entry covers, or null if it doesn't touch date.
function timeOffSpan(entry: TimeOff, date: LocalDate): Interval | null {
  if (date < entry.startsOn || date > entry.endsOn) return null;
  if (entry.startMinute != null && entry.endMinute != null) return { start: entry.startMinute, end: entry.endMinute };
  return { start: 0, end: MINUTES_PER_DAY };
}

export function dayView(staff: StaffSchedule, location: LocationSchedule, date: LocalDate): DayView {
  const weekday = weekdayOf(date);
  const open = mergeIntervals(location.weekly[weekday] ?? []);
  const override = staff.overrides[date];
  const hours = hoursOn(staff, date);
  const timeOff = staff.timeOff.filter((t) => timeOffSpan(t, date) !== null);
  const blocked = timeOff.filter((t) => t.status === "approved").map((t) => timeOffSpan(t, date)!);

  return {
    date,
    weekday,
    open,
    hours,
    changed: override !== undefined,
    timeOff,
    available: subtractIntervals(intersectIntervals(hours, open), blocked),
  };
}

// Whether the staff member can take a booking from `start` for
// `durationMinutes`. The span must fit on one local day (salons aren't open
// across midnight). Durations are counted in wall-clock minutes.
export function isAvailable(
  staff: StaffSchedule,
  location: LocationSchedule,
  start: Date,
  durationMinutes: number,
): Availability {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return { available: false, reason: "invalid_duration" };

  const local = toLocal(start, location.timeZone);
  const from = local.minute;
  const to = from + durationMinutes;
  if (to > MINUTES_PER_DAY) return { available: false, reason: "crosses_midnight" };

  const day = dayView(staff, location, local.date);
  if (!containsSpan(day.open, from, to)) return { available: false, reason: "location_closed" };
  if (!containsSpan(day.hours, from, to)) return { available: false, reason: "not_working" };

  const approved = day.timeOff.filter((t) => t.status === "approved").map((t) => timeOffSpan(t, local.date)!);
  if (overlapsSpan(approved, from, to)) return { available: false, reason: "time_off" };

  return { available: true };
}
