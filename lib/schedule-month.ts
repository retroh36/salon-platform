// The team schedule's month (Scheduling → Month), pure and unit-tested:
// copying a week's shifts forward, copying one person's days onto another,
// and each person's month at a glance. Cells are the week grid's
// (./team-schedule.ts); loading is in ./schedule-month-load.ts, saving
// through the week's draft (save_schedule_drafts) like any other edit.

import { addDays, type LocalDate } from "./scheduling/time.ts";
import { cellKey, sameShifts, scheduledMinutes, shown, type Cell, type DayEdit } from "./team-schedule.ts";

// How many weeks ahead a week can be copied in one go.
export const MAX_COPY_WEEKS = 8;
// The longest stretch copied from one person to another.
export const MAX_COPY_DAYS = 92;

// Copies the week starting `sourceWeek` onto each of the next `weeks`
// weeks, day for day (everyone, or only `staffId`), as shown (drafts
// included). Past days and days already the same are left alone.
export function copyForward(cells: readonly Cell[], sourceWeek: LocalDate, weeks: number, today: LocalDate, staffId: string | null = null): DayEdit[] {
  const byKey = new Map(cells.map((c) => [cellKey(c.staffId, c.date), c]));
  const last = addDays(sourceWeek, 6);
  const edits: DayEdit[] = [];
  for (const c of cells) {
    if (c.date < sourceWeek || c.date > last || (staffId && c.staffId !== staffId)) continue;
    for (let k = 1; k <= weeks; k++) {
      const target = byKey.get(cellKey(c.staffId, addDays(c.date, 7 * k)));
      if (!target || target.date < today || sameShifts(shown(c), shown(target))) continue;
      edits.push({ staffId: c.staffId, date: target.date, shifts: shown(c) });
    }
  }
  return edits.sort((a, b) => a.date.localeCompare(b.date));
}

// Gives `toId` the same shifts as `fromId` on each day from `from` to `to`
// (days off included), from today on.
export function copyPerson(cells: readonly Cell[], fromId: string, toId: string, from: LocalDate, to: LocalDate, today: LocalDate): DayEdit[] {
  const target = new Map(cells.filter((c) => c.staffId === toId).map((c) => [c.date, c]));
  return cells
    .filter((c) => c.staffId === fromId && c.date >= from && c.date <= to && c.date >= today)
    .flatMap((c) => {
      const t = target.get(c.date);
      return t && !sameShifts(shown(c), shown(t)) ? [{ staffId: toId, date: c.date, shifts: shown(c) }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type PersonMonth = { scheduled: number; days: number; timeOffDays: number; clients: number; drafts: number };

// One person's month: hours scheduled (less approved time off), days
// working, days with time off, clients booked and days changed in the draft.
export function personMonth(cells: readonly Cell[], staffId: string, month: string): PersonMonth {
  const mine = cells.filter((c) => c.staffId === staffId && c.date.startsWith(month));
  return {
    scheduled: mine.reduce((n, c) => n + scheduledMinutes(c), 0),
    days: mine.filter((c) => scheduledMinutes(c) > 0).length,
    timeOffDays: mine.filter((c) => c.timeOff.length > 0).length,
    clients: new Set(mine.flatMap((c) => c.booked.map((b) => b.appointmentId))).size,
    drafts: mine.filter((c) => c.draft && !sameShifts(c.draft, c.live)).length,
  };
}
