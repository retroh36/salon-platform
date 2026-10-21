// Is a staff member available at a given time?
//
// The single source of truth for working hours; the calendar, online booking
// and the AI scheduler all build on this. Pure functions over data loaded by
// ./load.ts, so they're easy to test.
//
// A staff member is available for [start, start + duration) when, on that
// local date:
//   1. the location is open for the whole span,
//   2. it falls within one of their working intervals (the date's one-off
//      change if there is one, otherwise their weekly hours), and
//   3. it doesn't overlap approved time off.
// Requested and declined time off don't block anything. Existing
// appointments are the booking engine's concern, not this module's.

import { containsSpan, intersectIntervals, mergeIntervals, overlapsSpan, subtractIntervals, type Interval } from "./intervals.ts";
import { MINUTES_PER_DAY, toLocal, weekdayOf, type LocalDate, type Weekday } from "./time.ts";

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
  weekly: WeeklyHours;
  // One-off changes: on these dates, these hours replace the weekly hours.
  overrides: Record<LocalDate, Interval[]>;
  timeOff: TimeOff[];
};

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
  const hours = mergeIntervals(override ?? staff.weekly[weekday] ?? []);
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
