// The waitlist and walk-ins: finding the gap a cancellation, no-show or
// Denise fix leaves open, ranking waitlist clients who'd fit it, and the
// next free qualified stylist for a walk-in. Pure, over a BookingContext;
// every suggestion is checked against the booking rules (./series.ts,
// ./booking.ts) like any booking.

import { dayView } from "./availability.ts";
import { durationMinutes, staffBusySpans, type BookedItem, type BookingContext } from "./booking.ts";
import { subtractIntervals, type Interval } from "./intervals.ts";
import { checkVisitOn, type VisitLine } from "./series.ts";
import { fromLocal, toLocal, type LocalDate } from "./time.ts";

const STEP = 5;
// Shorter gaps aren't worth offering.
export const MIN_OPENING = 30;

// Times of day a waitlist client can come, in local minutes.
export const TIME_WINDOWS = {
  morning: { start: 9 * 60, end: 12 * 60, label: "Mornings" },
  afternoon: { start: 12 * 60, end: 17 * 60, label: "Afternoons" },
  evening: { start: 17 * 60, end: 21 * 60, label: "Evenings" },
} as const;
export type WindowName = keyof typeof TIME_WINDOWS;

export type WaitlistEntry = {
  id: string;
  clientId: string;
  serviceIds: string[];
  // Empty: any stylist who does the services.
  staffIds: string[];
  fromDate: LocalDate;
  toDate: LocalDate;
  // Empty: any time.
  windows: WindowName[];
  createdAt: Date;
};

export type FreedSlot = { staffId: string; date: LocalDate; start: number; end: number };

// Time the stylist is free on a date: their bookable hours minus what
// they're busy with (clients, lunches and other blocked time).
export function freeTime(ctx: BookingContext, staffId: string, date: LocalDate, also: readonly BookedItem[] = []): Interval[] {
  const staff = ctx.staff.get(staffId);
  if (!staff?.isActive) return [];
  const tz = ctx.location.timeZone;
  const local = (d: Date) => {
    const l = toLocal(d, tz);
    return l.date === date ? l.minute : l.date < date ? 0 : 24 * 60;
  };
  const busy = [...ctx.booked, ...also]
    .filter((b) => b.staffId === staffId)
    .flatMap((b) => staffBusySpans(b).map((s) => ({ start: local(new Date(s.start)), end: local(new Date(s.end)) })))
    .concat((ctx.blocks ?? []).filter((b) => b.staffId === staffId && b.date === date).map((b) => ({ start: local(b.start), end: local(b.end) })))
    .filter((i) => i.end > i.start);
  return subtractIntervals(dayView(staff.schedule, ctx.location, date).available, busy);
}

// The free gap around time that was just freed (a canceled visit, or where
// Denise moved one from), from `notBefore` on; null if it's too short.
export function openingAround(ctx: BookingContext, staffId: string, date: LocalDate, freed: Interval, notBefore = 0): FreedSlot | null {
  const overlap = (i: Interval) => Math.min(i.end, freed.end) - Math.max(i.start, freed.start);
  const gap = freeTime(ctx, staffId, date)
    .filter((i) => overlap(i) > 0)
    .sort((a, b) => overlap(b) - overlap(a))[0];
  if (!gap) return null;
  const start = Math.max(gap.start, Math.ceil(notBefore / STEP) * STEP);
  return gap.end - start >= MIN_OPENING ? { staffId, date, start, end: gap.end } : null;
}

// A visit's services one after another with one stylist, from `start`,
// each with a free chair (as the booking panel does), if the salon has any.
export function chainLines(ctx: BookingContext, serviceIds: readonly string[], staffId: string, start: number): VisitLine[] | null {
  const resource = [...ctx.resources.values()].some((r) => r.isActive && r.kind === "chair") ? "any" : "none";
  const lines: VisitLine[] = [];
  let at = start;
  for (const id of serviceIds) {
    const service = ctx.services.get(id);
    if (!service || service.archived) return null;
    lines.push({ serviceId: id, staffId, startMinute: at, resource });
    at += durationMinutes(service);
  }
  return lines;
}

const visitMinutes = (ctx: BookingContext, serviceIds: readonly string[]) => serviceIds.reduce((sum, id) => sum + (ctx.services.get(id) ? durationMinutes(ctx.services.get(id)!) : 0), 0);

export type WaitlistMatch = { entryId: string; clientId: string; staffId: string; start: number; end: number; lines: VisitLine[]; preferred: boolean };

// Waitlist clients who'd fit an opening: on a date they asked for, with a
// stylist they'd see, in a window they can do, starting in the gap. Those
// who asked for this stylist first, then whoever has waited longest.
export function matchOpening(ctx: BookingContext, opening: FreedSlot, entries: readonly WaitlistEntry[]): WaitlistMatch[] {
  const staff = ctx.staff.get(opening.staffId);
  if (!staff) return [];
  const matches: WaitlistMatch[] = [];
  for (const e of entries) {
    if (opening.date < e.fromDate || opening.date > e.toDate) continue;
    if (e.staffIds.length && !e.staffIds.includes(opening.staffId)) continue;
    if (!e.serviceIds.every((id) => staff.serviceIds.has(id))) continue;
    const length = visitMinutes(ctx, e.serviceIds);
    const windows: Interval[] = e.windows.length ? e.windows.map((w) => TIME_WINDOWS[w]) : [{ start: 0, end: 24 * 60 }];
    for (let t = opening.start; t < opening.end; t += STEP) {
      if (!windows.some((w) => t >= w.start && t + length <= w.end)) continue;
      const lines = chainLines(ctx, e.serviceIds, opening.staffId, t);
      if (lines && checkVisitOn(ctx, lines, opening.date).ok) {
        matches.push({ entryId: e.id, clientId: e.clientId, staffId: opening.staffId, start: t, end: t + length, lines, preferred: e.staffIds.length > 0 });
        break;
      }
    }
  }
  const created = new Map(entries.map((e) => [e.id, e.createdAt.getTime()]));
  return matches.sort((a, b) => Number(b.preferred) - Number(a.preferred) || created.get(a.entryId)! - created.get(b.entryId)!);
}

export type WalkIn = { id: string; serviceId: string };
export type WalkInEstimate = { id: string; staffId: string; start: number; wait: number; lines: VisitLine[] } | { id: string; staffId: null };

// The next free stylist who does the service, from `from` (local minutes)
// today, checked against the booking rules. Ties go to whoever has the
// lighter day.
export function nextFree(ctx: BookingContext, serviceId: string, date: LocalDate, from: number, also: readonly BookedItem[] = []): { staffId: string; start: number; lines: VisitLine[]; resource: string | null } | null {
  const calendar = { ...ctx, booked: [...ctx.booked, ...also] };
  const load = (staffId: string) => calendar.booked.filter((b) => b.staffId === staffId).length;
  const staff = [...ctx.staff.values()].filter((s) => s.isActive && s.serviceIds.has(serviceId)).sort((a, b) => load(a.id) - load(b.id) || a.id.localeCompare(b.id));
  for (let t = Math.ceil(from / STEP) * STEP; t < 24 * 60; t += STEP) {
    for (const s of staff) {
      const lines = chainLines(ctx, [serviceId], s.id, t);
      if (!lines) return null;
      const check = checkVisitOn(calendar, lines, date);
      if (check.ok) return { staffId: s.id, start: t, lines, resource: check.resources[0] };
    }
  }
  return null;
}

// Estimates for the walk-in queue in order: each takes the next free
// stylist after those ahead of them.
export function walkInQueue(ctx: BookingContext, queue: readonly WalkIn[], date: LocalDate, now: number): WalkInEstimate[] {
  const placed: BookedItem[] = [];
  return queue.map((w) => {
    const next = nextFree(ctx, w.serviceId, date, now, placed);
    const service = ctx.services.get(w.serviceId);
    if (!next || !service) return { id: w.id, staffId: null };
    placed.push({ ...service, id: `walk-in:${w.id}`, appointmentId: `walk-in:${w.id}`, serviceId: w.serviceId, staffId: next.staffId, resourceId: next.resource, start: fromLocal(date, next.start, ctx.location.timeZone)! });
    return { id: w.id, staffId: next.staffId, start: next.start, wait: Math.max(0, next.start - now), lines: next.lines };
  });
}
