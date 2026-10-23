// Rebooking before the client leaves: their next visit, from their usual
// rhythm and stylist, at a time that passes the booking rules. Pure, over a
// BookingContext.

import type { BookingContext } from "@/lib/scheduling/booking";
import { checkVisitOn, type VisitLine } from "@/lib/scheduling/series";
import { addDays, formatMinute, type LocalDate } from "@/lib/scheduling/time";
import { chainLines } from "@/lib/scheduling/waitlist";

export type RebookSuggestion = {
  date: LocalDate;
  startMinute: number;
  staffId: string;
  serviceIds: string[];
  lines: VisitLine[];
  // "Daniel usually comes every 4 weeks with Gil."
  why: string;
  // "Fri, Nov 20 at 11:30am"
  when: string;
};

// How many weeks until they're usually back: their own rhythm, else six
// weeks.
export function weeksUntilNext(intervalDays: number | null): number {
  return Math.max(1, Math.round((intervalDays ?? 42) / 7));
}

// The visit's services with the stylist, back to back, at every start that
// fits on a date, nearest the time they came today first.
export function fitsOn(ctx: BookingContext, date: LocalDate, staffId: string, serviceIds: readonly string[], aroundMinute: number, step = 15): VisitLine[][] {
  const out: { lines: VisitLine[]; distance: number }[] = [];
  for (let start = 7 * 60; start <= 21 * 60; start += step) {
    const lines = chainLines(ctx, serviceIds, staffId, start);
    if (!lines) continue;
    if (checkVisitOn(ctx, lines, date).ok) out.push({ lines, distance: Math.abs(start - aroundMinute) });
  }
  return out.sort((a, b) => a.distance - b.distance || a.lines[0].startMinute - b.lines[0].startMinute).map((o) => o.lines);
}

export function suggestRebook(
  ctx: BookingContext,
  input: {
    today: LocalDate;
    clientFirstName: string;
    intervalDays: number | null;
    // The stylist they usually see (or today's), and today's services with them.
    staffId: string;
    staffFirstName: string;
    serviceIds: string[];
    // When they came today, to suggest the same time.
    aroundMinute: number;
    formatDate: (d: LocalDate) => string;
  },
): RebookSuggestion | null {
  if (!input.serviceIds.length) return null;
  const weeks = weeksUntilNext(input.intervalDays);
  const target = addDays(input.today, weeks * 7);
  // The usual day, then the days either side, up to a week.
  for (const offset of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7]) {
    const date = addDays(target, offset);
    if (date <= input.today) continue;
    const [best] = fitsOn(ctx, date, input.staffId, input.serviceIds, input.aroundMinute);
    if (best) {
      const start = best[0].startMinute;
      return {
        date,
        startMinute: start,
        staffId: input.staffId,
        serviceIds: input.serviceIds,
        lines: best,
        why: input.intervalDays
          ? `${input.clientFirstName} usually comes every ${weeks} ${weeks === 1 ? "week" : "weeks"} with ${input.staffFirstName}.`
          : `In ${weeks} weeks with ${input.staffFirstName}, the same time as today.`,
        when: `${input.formatDate(date)} at ${formatMinute(start)}`,
      };
    }
  }
  return null;
}
