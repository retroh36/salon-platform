// The calendar's month (`/calendar/month`): the month as weeks, Monday to
// Sunday, and each day at a glance: visits booked, how full the stylists
// are, who's off and any events. Pure; the page loads the data.

import { fullness } from "@/lib/dashboard";
import { dayView } from "@/lib/scheduling/availability";
import type { BookingContext } from "@/lib/scheduling/booking";
import { addDays, isLocalDate, startOfWeek, weekdayOf, type LocalDate } from "@/lib/scheduling/time";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "2026-11": the month asked for (?month=, or a date in it), else today's.
export function parseMonth(param: string | undefined, today: LocalDate): string {
  if (param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param)) return param;
  if (param && isLocalDate(param)) return param.slice(0, 7);
  return today.slice(0, 7);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

// Whole weeks, Monday to Sunday, covering the month.
export function monthWeeks(month: string): LocalDate[][] {
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const weeks: LocalDate[][] = [];
  for (let start = startOfWeek(first); start <= last; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return weeks;
}

export type MonthEvent = { id: string; date: LocalDate; label: string };

export type MonthDay = {
  date: LocalDate;
  inMonth: boolean;
  closed: boolean;
  // Visits booked (not canceled or missed).
  visits: number;
  // How much of the stylists' working time is booked, or null with nobody working.
  percent: number | null;
  // Stylists not working on a day the salon is open.
  off: number;
  events: MonthEvent[];
};

export function monthDays(
  month: string,
  ctx: BookingContext,
  stylistIds: readonly string[],
  visitsByDay: ReadonlyMap<LocalDate, number>,
  events: readonly MonthEvent[],
): MonthDay[][] {
  return monthWeeks(month).map((week) =>
    week.map((date) => {
      const closed = (ctx.location.weekly[weekdayOf(date)] ?? []).length === 0;
      const off = closed
        ? 0
        : stylistIds.filter((id) => {
            const s = ctx.staff.get(id);
            return !s || dayView(s.schedule, ctx.location, date).available.length === 0;
          }).length;
      return {
        date,
        inMonth: date.startsWith(month),
        closed,
        visits: visitsByDay.get(date) ?? 0,
        percent: closed ? null : fullness(ctx, stylistIds, date).percent,
        off,
        events: events.filter((e) => e.date === date),
      };
    }),
  );
}

// How full a day reads at a glance: under half, most of it, or nearly full.
export function fullnessTone(percent: number | null): "quiet" | "busy" | "full" | null {
  if (percent === null) return null;
  return percent >= 85 ? "full" : percent >= 50 ? "busy" : "quiet";
}
