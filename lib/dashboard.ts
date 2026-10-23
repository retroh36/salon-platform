// The Dashboard's numbers, worked out from the day's visits and the
// booking rules' view of the calendar. Pure: loading is in
// ./dashboard-load.ts. Every number on the Dashboard comes from here or
// from lib/insights/, never from Claude.

import type { AppointmentStatus } from "@/lib/appointments";
import { dayView } from "@/lib/scheduling/availability";
import type { BookingContext } from "@/lib/scheduling/booking";
import type { Disruption } from "@/lib/scheduling/resolve";
import { subtractIntervals, type Interval } from "@/lib/scheduling/intervals";
import { toLocal, type LocalDate } from "@/lib/scheduling/time";
import { freeTime } from "@/lib/scheduling/waitlist";

// One service on a visit, in local minutes on its day.
export type DayVisit = {
  appointmentId: string;
  itemId: string;
  staffId: string;
  clientId: string | null;
  // "Ava K.", or "Walk-in".
  client: string;
  service: string;
  start: number;
  end: number;
  status: AppointmentStatus;
  // Minute of the day the client checked in, if they have.
  checkedInAt: number | null;
  started: boolean;
  finished: boolean;
  priceCents: number;
};

// A client is running late from this many minutes after their start, up
// to LATE_UNTIL (later than that, they're a no-show to mark).
export const LATE_AFTER = 5;
export const LATE_UNTIL = 60;
// "Up next": starting within this many minutes.
export const UP_NEXT_MINUTES = 60;
// Gaps worth filling are at least this long.
export const GAP_MINUTES = 60;

const sum = (xs: readonly Interval[]) => xs.reduce((n, i) => n + Math.max(0, i.end - i.start), 0);
const holdsTime = (s: AppointmentStatus) => s !== "canceled" && s !== "no_show";

// The day's counts. `byMinute`: check-ins only up to then (to compare
// "so far" with the same time last week).
export function dayCounts(visits: readonly DayVisit[], byMinute: number | null = null) {
  const visitsOf = (keep: (v: DayVisit) => boolean) => new Set(visits.filter(keep).map((v) => v.appointmentId)).size;
  return {
    appointments: visitsOf((v) => v.status !== "canceled"),
    checkedIn: visitsOf((v) => v.checkedInAt !== null && (byMinute === null || v.checkedInAt <= byMinute)),
    noShows: visitsOf((v) => v.status === "no_show"),
    canceled: visitsOf((v) => v.status === "canceled"),
    expectedCents: visits.filter((v) => holdsTime(v.status)).reduce((n, v) => n + v.priceCents, 0),
  };
}

export type DayCounts = ReturnType<typeof dayCounts>;

// How booked a stylist is on a date: minutes they could work (hours, less
// blocked time like lunch) and minutes taken by clients (processing time
// counts as free, as it does for booking).
export function stylistLoad(ctx: BookingContext, staffId: string, date: LocalDate): { available: number; booked: number } {
  const staff = ctx.staff.get(staffId);
  if (!staff?.isActive) return { available: 0, booked: 0 };
  const tz = ctx.location.timeZone;
  const local = (d: Date) => {
    const l = toLocal(d, tz);
    return l.date === date ? l.minute : l.date < date ? 0 : 24 * 60;
  };
  const blocked = (ctx.blocks ?? []).filter((b) => b.staffId === staffId && b.date === date).map((b) => ({ start: local(b.start), end: local(b.end) }));
  const available = sum(subtractIntervals(dayView(staff.schedule, ctx.location, date).available, blocked));
  const free = sum(freeTime(ctx, staffId, date));
  return { available, booked: Math.max(0, available - free) };
}

// How full the book is: booked stylist time over available, for these
// stylists. Null when nobody works.
export function fullness(ctx: BookingContext, staffIds: readonly string[], date: LocalDate): { available: number; booked: number; percent: number | null } {
  let available = 0;
  let booked = 0;
  for (const id of staffIds) {
    const l = stylistLoad(ctx, id, date);
    available += l.available;
    booked += l.booked;
  }
  return { available, booked, percent: available > 0 ? Math.round((booked / available) * 100) : null };
}

// Now against the same day last week: up, down or level.
export function compare(now: number, then: number): { now: number; then: number; change: number } {
  return { now, then, change: now - then };
}

export type RightNow = {
  inChair: DayVisit[];
  upNext: DayVisit[];
  late: (DayVisit & { lateMinutes: number })[];
};

// Who's in the chair (checked in and started, not finished; or checked in
// with their visit under way), who's starting in the next hour, and
// clients who haven't arrived 5 to 60 minutes after their start.
export function rightNow(visits: readonly DayVisit[], nowMinute: number): RightNow {
  const firstOf = new Map<string, DayVisit>();
  for (const v of [...visits].sort((a, b) => a.start - b.start)) if (!firstOf.has(v.appointmentId)) firstOf.set(v.appointmentId, v);
  const firsts = [...firstOf.values()];
  const waiting = (v: DayVisit) => v.status === "booked" || v.status === "confirmed";
  return {
    inChair: visits
      .filter((v) => v.status === "checked_in" && !v.finished && (v.started || (v.start <= nowMinute && v.end > nowMinute)))
      .sort((a, b) => a.start - b.start),
    upNext: firsts.filter((v) => waiting(v) && v.start >= nowMinute && v.start <= nowMinute + UP_NEXT_MINUTES),
    late: firsts.filter((v) => waiting(v) && nowMinute - v.start >= LATE_AFTER && nowMinute - v.start <= LATE_UNTIL).map((v) => ({ ...v, lateMinutes: nowMinute - v.start })),
  };
}

export type StylistStatus = "in_service" | "free" | "on_break" | "running_late" | "done" | "off";

export type StylistToday = {
  staffId: string;
  percent: number | null;
  visits: number;
  next: { client: string; start: number; service: string } | null;
  status: StylistStatus;
};

// Each working stylist's day at a glance: how booked, who's next, and what
// they're doing now (with `nowMinute`; null for another day).
export function stylistToday(
  ctx: BookingContext,
  visits: readonly DayVisit[],
  staffId: string,
  date: LocalDate,
  nowMinute: number | null,
  disruptions: readonly Disruption[] = [],
): StylistToday | null {
  const load = stylistLoad(ctx, staffId, date);
  const mine = visits.filter((v) => v.staffId === staffId && holdsTime(v.status)).sort((a, b) => a.start - b.start);
  if (load.available === 0 && !mine.length) return null;
  const upcoming = mine.find((v) => (v.status === "booked" || v.status === "confirmed") && (nowMinute === null || v.start >= nowMinute - LATE_AFTER));
  const base = {
    staffId,
    percent: load.available > 0 ? Math.round((load.booked / load.available) * 100) : null,
    visits: new Set(mine.map((v) => v.appointmentId)).size,
    next: upcoming ? { client: upcoming.client, start: upcoming.start, service: upcoming.service } : null,
  };
  if (nowMinute === null) return { ...base, status: "free" };

  const tz = ctx.location.timeZone;
  const local = (d: Date) => toLocal(d, tz).minute;
  const staff = ctx.staff.get(staffId);
  const hours = staff ? dayView(staff.schedule, ctx.location, date).available : [];
  const callOut = disruptions.some((d) => d.kind === "call_out" && d.staffId === staffId && local(d.from) <= nowMinute);
  const overrun = disruptions.some((d) => d.kind === "overrun" && mine.some((v) => v.itemId === d.itemId && !v.finished));
  const current = mine.find((v) => v.status === "checked_in" && !v.finished && (v.started || (v.start <= nowMinute && v.end > nowMinute)));
  const onBreak = (ctx.blocks ?? []).some((b) => b.staffId === staffId && b.date === date && local(b.start) <= nowMinute && local(b.end) > nowMinute);

  let status: StylistStatus;
  if (callOut) status = "off";
  else if (current && (overrun || current.end <= nowMinute)) status = "running_late";
  else if (current) status = "in_service";
  else if (onBreak) status = "on_break";
  else if (!hours.some((h) => h.end > nowMinute)) status = hours.length ? "done" : "off";
  else status = "free";
  return { ...base, status };
}

// Free time worth filling: gaps of an hour or more in stylists' days,
// from `notBefore` (now, for today), longest first.
export function gapsWorthFilling(ctx: BookingContext, staffIds: readonly string[], date: LocalDate, notBefore = 0): { staffId: string; date: LocalDate; start: number; end: number }[] {
  return staffIds
    .flatMap((staffId) =>
      freeTime(ctx, staffId, date)
        .map((i) => ({ staffId, date, start: Math.max(i.start, Math.ceil(notBefore / 15) * 15), end: i.end }))
        .filter((g) => g.end - g.start >= GAP_MINUTES),
    )
    .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
}
