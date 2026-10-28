// Recurring appointments: the dates of a series, checking each visit
// against the booking rules (./booking.ts), and alternatives for visits that
// don't fit. Pure, over a BookingContext covering the whole series.
//
// A visit is its lines (service, stylist, chair choice, start time of day),
// the same on every date. When a date doesn't fit, the alternatives are, in
// order: the nearest time that day with the same stylists (up to 3 hours
// either way), the same time with another stylist who does the service,
// then the same time on a nearby day (up to 3 days either way).

import { checkItem, pickResource, timingFor, type BookedItem, type BookingContext, type BookingProblem } from "./booking.ts";
import { addDays, fromLocal, MINUTES_PER_DAY, type LocalDate } from "./time.ts";

export const MAX_VISITS = 52;
const MAX_TIME_SHIFT = 180;
const TIME_STEP = 15;
const MAX_DAY_SHIFT = 3;

export type SeriesEnd = { kind: "count"; count: number } | { kind: "until"; until: LocalDate };

// Every `intervalWeeks` weeks from `first`, for `count` visits or until a
// date (inclusive), at most MAX_VISITS.
export function seriesDates(first: LocalDate, intervalWeeks: number, end: SeriesEnd): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let d = first; dates.length < MAX_VISITS; d = addDays(d, intervalWeeks * 7)) {
    if (end.kind === "count" && dates.length >= end.count) break;
    if (end.kind === "until" && d > end.until) break;
    dates.push(d);
  }
  return dates;
}

// "any" for a free chair, "none", or a resource id.
export type VisitLine = {
  serviceId: string;
  staffId: string;
  startMinute: number;
  resource: string;
  // On an edit: the item this line was on the edited visit (other visits'
  // match it by its service), and a length chosen for this booking.
  itemId?: string;
  minutes?: number;
};

export type VisitCheck = {
  ok: boolean;
  // One list per line, in order.
  problems: BookingProblem[][];
  // The chair each line would get.
  resources: (string | null)[];
};

// Whether a visit's lines fit on a date: each against the calendar and the
// lines before it, with a free chair where one's wanted.
export function checkVisitOn(ctx: BookingContext, lines: readonly VisitLine[], date: LocalDate, ignoreAppointment?: string): VisitCheck {
  const calendar = ignoreAppointment ? { ...ctx, booked: ctx.booked.filter((b) => b.appointmentId !== ignoreAppointment) } : ctx;
  const accepted: BookedItem[] = [];
  const problems: BookingProblem[][] = [];
  const resources: (string | null)[] = [];
  for (const line of lines) {
    const start = line.startMinute >= 0 && line.startMinute < MINUTES_PER_DAY ? fromLocal(date, line.startMinute, ctx.location.timeZone) : null;
    const service = ctx.services.get(line.serviceId);
    if (!start || !service) {
      problems.push([{ code: start ? "unknown_service" : "invalid_start" }]);
      resources.push(null);
      continue;
    }
    let resourceId: string | null = line.resource === "none" ? null : line.resource === "any" ? null : line.resource;
    const mine: BookingProblem[] = [];
    if (line.resource === "any") {
      resourceId = pickResource(calendar, { ...timingFor(ctx, line.staffId, service.id)!, serviceId: service.id, staffId: line.staffId, start }, null, accepted);
      if (!resourceId && !service.needsRoom) mine.push({ code: "no_free_resource" });
    }
    const check = checkItem(calendar, { serviceId: line.serviceId, staffId: line.staffId, resourceId, start }, accepted);
    if (check.valid) accepted.push(check.item);
    else mine.push(...check.problems);
    problems.push(mine);
    resources.push(resourceId);
  }
  return { ok: problems.every((p) => p.length === 0), problems, resources };
}

export type Alternative = {
  kind: "time" | "stylist" | "day";
  date: LocalDate;
  lines: VisitLine[];
  // Minutes later (negative: earlier), or days, for the label.
  shift: number;
};

// Up to two ways a visit that doesn't fit on `date` could: one of each
// kind, in order of preference.
export function alternativesFor(ctx: BookingContext, lines: readonly VisitLine[], date: LocalDate): Alternative[] {
  const found: Alternative[] = [];
  const fits = (l: VisitLine[], d: LocalDate) => checkVisitOn(ctx, l, d).ok;

  for (let step = TIME_STEP; step <= MAX_TIME_SHIFT && !found.length; step += TIME_STEP) {
    for (const shift of [step, -step]) {
      const moved = lines.map((l) => ({ ...l, startMinute: l.startMinute + shift }));
      if (moved.every((l) => l.startMinute >= 0 && l.startMinute < MINUTES_PER_DAY) && fits(moved, date)) {
        found.push({ kind: "time", date, lines: moved, shift });
        break;
      }
    }
  }

  // Another stylist for each line that doesn't fit, same time.
  const check = checkVisitOn(ctx, lines, date);
  let swapped: VisitLine[] | null = lines.map((l) => ({ ...l }));
  check.problems.forEach((p, i) => {
    if (!p.length || !swapped) return;
    const other = [...ctx.staff.values()].find(
      (s) => s.id !== lines[i].staffId && s.isActive && s.serviceIds.has(lines[i].serviceId) && fits(swapped!.map((l, n) => (n === i ? { ...l, staffId: s.id } : l)), date),
    );
    if (other) swapped[i] = { ...swapped[i], staffId: other.id };
    else swapped = null;
  });
  if (swapped && !check.ok && fits(swapped, date)) found.push({ kind: "stylist", date, lines: swapped, shift: 0 });

  for (let d = 1; d <= MAX_DAY_SHIFT && found.length < 2; d++) {
    const day = [addDays(date, d), addDays(date, -d)].find((x) => fits([...lines], x));
    if (day) {
      found.push({ kind: "day", date: day, lines: [...lines], shift: d * (day > date ? 1 : -1) });
      break;
    }
  }
  return found.slice(0, 2);
}

export type PlannedVisit = { date: LocalDate; check: VisitCheck; alternatives: Alternative[] };

// Each date of a series, checked, with alternatives where it doesn't fit.
export function planSeries(ctx: BookingContext, lines: readonly VisitLine[], dates: readonly LocalDate[]): PlannedVisit[] {
  return dates.map((date) => {
    const check = checkVisitOn(ctx, lines, date);
    return { date, check, alternatives: check.ok ? [] : alternativesFor(ctx, lines, date) };
  });
}

export type Scope = "this" | "following" | "all";

// Which visits of a series a change applies to: this one, this one and the
// ones after it, or all of them; only visits that can still change.
export function visitsInScope<T extends { index: number; editable: boolean }>(visits: readonly T[], thisIndex: number, scope: Scope): T[] {
  return visits.filter((v) => v.editable && (scope === "all" || (scope === "this" ? v.index === thisIndex : v.index >= thisIndex)));
}
