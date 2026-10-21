// Phorest rosters are dated ("works 9-5 on Oct 27"); ours are a weekly
// template plus one-off changes and time off. For each staff member, the
// most common hours for each weekday across the sampled dates become their
// weekly hours. Future dates that differ become one-off changes, or time
// off when they're rostered off on a usual working day.
//
// Only dates Phorest says something about count: a WORKING slot, or an
// explicit NON_WORKING day. A date with no slots, or only NOT_SPECIFIED,
// means "no roster", not "day off", so it neither votes on the usual week
// nor becomes time off.

import { mergeIntervals, subtractIntervals, validateIntervals, type Interval } from "../../../scheduling/intervals.ts";
import { datesBetween, isLocalDate, weekdayOf, type LocalDate, type Weekday } from "../../../scheduling/time.ts";
import type { IssueLog } from "../issues.ts";
import type { OverrideRecord, TimeOffRecord, WeeklyHoursRecord } from "../model.ts";
import type { PhorestWorkTimeTable } from "../types.ts";
import { localTimeToMinutes, toFiveMinutes } from "./common.ts";

export const IMPORTED_TIME_OFF_NOTE = "Rostered off in Phorest (imported)";

// Working intervals for one date from its time slots.
function dayIntervals(slots: NonNullable<PhorestWorkTimeTable["timeSlots"]>, log: IssueLog): Interval[] {
  const intervals: Interval[] = [];
  for (const slot of slots) {
    if (slot.type !== "WORKING") continue;
    const rawStart = localTimeToMinutes(slot.startTime);
    let rawEnd = localTimeToMinutes(slot.endTime);
    if (rawEnd === 0) rawEnd = 1440; // ends at midnight
    if (rawStart === null || rawEnd === null || rawStart >= rawEnd) {
      log.add("work_timetable", "startTime/endTime", "skipped", "missing or invalid shift times");
      continue;
    }
    const start = toFiveMinutes(rawStart, "down");
    const end = toFiveMinutes(rawEnd, "up");
    if (start !== rawStart || end !== rawEnd) log.add("work_timetable", "startTime/endTime", "adjusted", "rounded to 5-minute steps");

    let pieces: Interval[] = [{ start, end }];
    // A break within the shift (timeOffStartTime/timeOffEndTime).
    const offStart = localTimeToMinutes(slot.timeOffStartTime);
    const offEnd = localTimeToMinutes(slot.timeOffEndTime);
    if (offStart !== null && offEnd !== null && offStart < offEnd) {
      pieces = subtractIntervals(pieces, [{ start: toFiveMinutes(offStart, "down"), end: toFiveMinutes(offEnd, "up") }]);
    }
    intervals.push(...pieces);
  }
  const merged = mergeIntervals(intervals);
  if (merged.length !== intervals.length) log.add("work_timetable", "timeSlots", "adjusted", "overlapping shifts merged");
  return merged;
}

const key = (intervals: Interval[]) => intervals.map((i) => `${i.start}-${i.end}`).join(",");

export function mapTimetables(
  timetables: PhorestWorkTimeTable[],
  { staffIds, from, to, today }: { staffIds: Set<string>; from: LocalDate; to: LocalDate; today: LocalDate },
  log: IssueLog,
): { weeklyHours: WeeklyHoursRecord[]; overrides: OverrideRecord[]; timeOff: TimeOffRecord[] } {
  // staff -> date -> intervals (dates with no working slot are days off)
  const byStaff = new Map<string, Map<LocalDate, Interval[]>>();
  for (const t of timetables) {
    if (!t.staffId || !staffIds.has(t.staffId)) {
      log.add("work_timetable", "staffId", "skipped", "staff member not imported");
      continue;
    }
    const days = byStaff.get(t.staffId) ?? new Map<LocalDate, Interval[]>();
    byStaff.set(t.staffId, days);
    const slotsByDate = new Map<LocalDate, NonNullable<PhorestWorkTimeTable["timeSlots"]>>();
    for (const slot of t.timeSlots ?? []) {
      if (!slot.date || !isLocalDate(slot.date)) {
        log.add("work_timetable", "date", "skipped", "missing or invalid date");
        continue;
      }
      slotsByDate.set(slot.date, [...(slotsByDate.get(slot.date) ?? []), slot]);
    }
    for (const [date, slots] of slotsByDate) {
      if (!slots.some((s) => s.type === "WORKING" || s.type === "NON_WORKING")) continue;
      days.set(date, mergeIntervals([...(days.get(date) ?? []), ...dayIntervals(slots, log)]));
    }
  }

  const weeklyHours: WeeklyHoursRecord[] = [];
  const overrides: OverrideRecord[] = [];
  const timeOff: TimeOffRecord[] = [];
  const dates = datesBetween(from, to);

  for (const [staffId, days] of byStaff) {
    // Most common pattern per weekday; ties go to the earliest date's pattern.
    const usual = new Map<Weekday, Interval[]>();
    for (const weekday of [1, 2, 3, 4, 5, 6, 7] as Weekday[]) {
      const counts = new Map<string, { intervals: Interval[]; count: number }>();
      for (const date of dates.filter((d) => weekdayOf(d) === weekday && days.has(d))) {
        const intervals = days.get(date)!;
        const k = key(intervals);
        const entry = counts.get(k) ?? { intervals, count: 0 };
        entry.count++;
        counts.set(k, entry);
      }
      let best: { intervals: Interval[]; count: number } | undefined;
      for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
      usual.set(weekday, best?.intervals ?? []);
    }

    for (const [weekday, intervals] of usual) {
      if (validateIntervals(intervals)) {
        log.add("work_timetable", "timeSlots", "skipped", "usual hours for a weekday are invalid");
        continue;
      }
      for (const i of intervals) weeklyHours.push({ staffExternalId: staffId, weekday, start_minute: i.start, end_minute: i.end });
    }

    for (const date of dates) {
      if (date < today || !days.has(date)) continue;
      const actual = days.get(date)!;
      const expected = usual.get(weekdayOf(date)) ?? [];
      if (key(actual) === key(expected)) continue;
      if (actual.length === 0) timeOff.push({ staffExternalId: staffId, starts_on: date, ends_on: date, note: IMPORTED_TIME_OFF_NOTE });
      else for (const i of actual) overrides.push({ staffExternalId: staffId, on_date: date, start_minute: i.start, end_minute: i.end });
    }
  }

  return { weeklyHours, overrides, timeOff };
}
