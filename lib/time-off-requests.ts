// Time-off requests, pure: whether a request is short notice or in a
// blackout (the same rules as `request_time_off`), the clients it would
// leave booked, who else is off then, and where to plan their clients.
import { addDays, datesBetween, minuteToTime, MINUTES_PER_DAY, type LocalDate } from "./scheduling/time.ts";

export type Span = { startsOn: LocalDate; endsOn: LocalDate; startMinute: number | null; endMinute: number | null };
export type Blackout = { startsOn: LocalDate; endsOn: LocalDate; label: string | null };

// Inside the notice period: it starts before today + the notice days.
export function isShortNotice(startsOn: LocalDate, today: LocalDate, noticeDays: number): boolean {
  return startsOn < addDays(today, noticeDays);
}

// The blackouts a span overlaps.
export function blackoutsFor(span: Pick<Span, "startsOn" | "endsOn">, blackouts: Blackout[]): Blackout[] {
  return blackouts.filter((b) => b.startsOn <= span.endsOn && span.startsOn <= b.endsOn);
}

// Whether two spans of time off overlap, minutes and all.
export function spansOverlap(a: Span, b: Span): boolean {
  if (a.startsOn > b.endsOn || b.startsOn > a.endsOn) return false;
  // Part-day spans are a single day each: they overlap only if the minutes do.
  const aStart = a.startMinute ?? 0;
  const aEnd = a.endMinute ?? MINUTES_PER_DAY;
  const bStart = b.startMinute ?? 0;
  const bEnd = b.endMinute ?? MINUTES_PER_DAY;
  if (a.startMinute == null && b.startMinute == null) return true;
  return aStart < bEnd && bStart < aEnd;
}

// A booked visit, as the salon's day and minutes.
export type BookedVisit = { appointmentId: string; date: LocalDate; start: number; end: number; client: string };

// The visits inside a span (part of the day: those that overlap its times).
export function visitsDuring(span: Span, visits: BookedVisit[]): BookedVisit[] {
  return visits
    .filter((v) => v.date >= span.startsOn && v.date <= span.endsOn)
    .filter((v) => span.startMinute == null || (v.start < span.endMinute! && span.startMinute < v.end))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

// The visits, by day, for "Tue, Nov 3: 3 clients".
export function visitsByDay(visits: BookedVisit[]): { date: LocalDate; visits: BookedVisit[] }[] {
  const days = new Map<LocalDate, BookedVisit[]>();
  for (const v of visits) days.set(v.date, [...(days.get(v.date) ?? []), v]);
  return [...days].map(([date, list]) => ({ date, visits: list }));
}

// Someone else's time off, approved or still asked for.
export type OtherOff = Span & { staffId: string; name: string; status: "approved" | "requested" };

// Who else is off (or has asked) during a span, each once.
export function othersOff(span: Span & { staffId: string }, others: OtherOff[]): OtherOff[] {
  const seen = new Set<string>();
  return others.filter((o) => {
    if (o.staffId === span.staffId || !spansOverlap(span, o) || seen.has(o.staffId)) return false;
    seen.add(o.staffId);
    return true;
  });
}

// The Mark out panel for one day of it: the whole day, or leaving early
// when it's the rest of the day from a time.
export function outPanelHref(staffId: string, date: LocalDate, span: Span): string {
  const leaves = span.startMinute != null && span.startMinute > 0 && (span.endMinute ?? MINUTES_PER_DAY) >= MINUTES_PER_DAY - 60;
  return `/calendar?date=${date}&out=${staffId}${leaves ? `&leaves=${minuteToTime(span.startMinute!)}` : ""}`;
}

// Each day of a span, for counting days off.
export function daysOf(span: Pick<Span, "startsOn" | "endsOn">): LocalDate[] {
  return datesBetween(span.startsOn, span.endsOn);
}
