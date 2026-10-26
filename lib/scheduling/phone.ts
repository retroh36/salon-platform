// Booking by asking Denise: the best times for a visit a client asks for
// ("balayage and a cut with Bridget next week, afternoons"). One or more
// services back to back, each checked with the booking rules (./booking.ts:
// hours, time off, blocked time, processing gaps, a free chair) at the
// length the stylist really takes (`timingOf`: their trusted usual time
// from lib/insights/, else their own or the menu's). Then the three best,
// each with a one-line reason in our words, never Claude's.
//
// Pure, over a BookingContext from ./load.ts.

import { dayView } from "./availability.ts";
import { checkItem, itemEnd, pickResource, staffBusySpans, type BookedItem, type BookingContext, type ServiceTiming } from "./booking.ts";
import { daysBetween, formatMinute, fromLocal, toLocal, weekdayOf, type LocalDate, type Weekday } from "./time.ts";

export type PartOfDay = "morning" | "afternoon" | "evening";

// When a visit may start, for each part of the day.
export const PART_WINDOWS: Record<PartOfDay, { from: number; to: number }> = {
  morning: { from: 0, to: 12 * 60 - 1 },
  afternoon: { from: 12 * 60, to: 17 * 60 - 1 },
  evening: { from: 17 * 60, to: 24 * 60 - 1 },
};

export type VisitSearch = {
  // In the order they're done, one to four.
  serviceIds: readonly string[];
  // Who may do it: the stylist asked for, a level's stylists, or null for anyone.
  staffIds: readonly string[] | null;
  dates: readonly LocalDate[];
  // Local minutes the visit may start between (inclusive).
  from: number;
  to: number;
  // Nothing before this instant (now, for today).
  notBefore: Date;
  // How long a service takes with a stylist.
  timingOf: (staffId: string, serviceId: string) => ServiceTiming | undefined;
  step?: number;
};

export type PlannedLine = { serviceId: string; staffId: string; resourceId: string | null; start: Date; startMinute: number; timing: ServiceTiming };

export type Candidate = { date: LocalDate; minute: number; start: Date; end: Date; lines: PlannedLine[] };

export const PHONE_STEP = 15;
// The most times looked at before ranking: enough for two weeks of a busy salon.
const MAX_CANDIDATES = 2000;

// The visit at `start`, with `first` doing the first service and keeping
// the rest where they can (else whoever may and is free), or null.
function planAt(ctx: BookingContext, s: VisitSearch, start: Date, first: string, allowed: readonly string[], hasChairs: boolean): PlannedLine[] | null {
  const tz = ctx.location.timeZone;
  const accepted: BookedItem[] = [];
  const lines: PlannedLine[] = [];
  let at = start;
  for (const [n, serviceId] of s.serviceIds.entries()) {
    const previous = lines.at(-1)?.staffId ?? first;
    const order = n === 0 ? [first] : [previous, ...allowed.filter((id) => id !== previous)];
    let placed: PlannedLine | null = null;
    for (const staffId of order) {
      const staff = ctx.staff.get(staffId);
      if (!staff?.isActive || !staff.serviceIds.has(serviceId)) continue;
      const timing = s.timingOf(staffId, serviceId);
      if (!timing) continue;
      const draft: BookedItem = { ...timing, serviceId, staffId, start: at };
      const resourceId = pickResource(ctx, draft, null, accepted);
      if (!resourceId && hasChairs) continue;
      const check = checkItem(ctx, { serviceId, staffId, resourceId, start: at, timing }, accepted);
      if (!check.valid) continue;
      accepted.push(check.item);
      placed = { serviceId, staffId, resourceId, start: at, startMinute: toLocal(at, tz).minute, timing };
      break;
    }
    if (!placed) return null;
    lines.push(placed);
    at = itemEnd(accepted.at(-1)!);
  }
  return lines;
}

// Every time the visit fits, on each date, with each stylist who could
// start it.
export function searchVisits(ctx: BookingContext, s: VisitSearch): Candidate[] {
  if (!s.serviceIds.length) return [];
  const step = s.step ?? PHONE_STEP;
  const hasChairs = [...ctx.resources.values()].some((r) => r.kind === "chair" && r.isActive);
  const allowed = [...ctx.staff.values()].filter((st) => st.isActive && (!s.staffIds || s.staffIds.includes(st.id))).map((st) => st.id);
  const firsts = allowed.filter((id) => ctx.staff.get(id)!.serviceIds.has(s.serviceIds[0]));
  const out: Candidate[] = [];
  for (const date of s.dates) {
    for (let minute = Math.ceil(s.from / step) * step; minute <= s.to; minute += step) {
      const start = fromLocal(date, minute, ctx.location.timeZone);
      if (!start || start < s.notBefore) continue;
      for (const first of firsts) {
        const lines = planAt(ctx, s, start, first, allowed, hasChairs);
        if (!lines) continue;
        const last = lines.at(-1)!;
        out.push({ date, minute, start, end: itemEnd({ ...last.timing, serviceId: last.serviceId, staffId: last.staffId, start: last.start }), lines });
        if (out.length >= MAX_CANDIDATES) return out;
      }
    }
  }
  return out;
}

// What we know about the client, for ranking.
export type Habits = {
  usualStaffId: string | null;
  // ISO weekday (1 = Monday).
  usualWeekday: number | null;
  usualPart: PartOfDay | null;
};

export type Ranked = Candidate & { score: number; reason: string };

const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
// A gap shorter than this between clients is hard to fill.
export const SMALL_GAP = 45;
const MINUTE_MS = 60_000;

export function partOf(minute: number): PartOfDay {
  return minute < 12 * 60 ? "morning" : minute < 17 * 60 ? "afternoon" : "evening";
}

// How the visit sits in its main stylist's day: what's just before and
// after it (a client, the start or end of their day) and how much free
// time that leaves either side.
type Fit = { before: number; after: number; clientBefore: number | null; clientAfter: number | null; dayStart: boolean; dayEnd: boolean };

function fitOf(ctx: BookingContext, c: Candidate): Fit {
  const staffId = c.lines[0].staffId;
  const tz = ctx.location.timeZone;
  const minute = (d: Date) => toLocal(d, tz).minute;
  const mine = c.lines.filter((l) => l.staffId === staffId).map((l) => ({ ...l.timing, serviceId: l.serviceId, staffId, start: l.start }));
  const spans = mine.flatMap(staffBusySpans);
  const from = Math.min(...spans.map((sp) => sp.start));
  const to = Math.max(...spans.map((sp) => sp.end));
  // Their other clients and blocked time that day, in local minutes.
  const busy = [
    ...ctx.booked.filter((b) => b.staffId === staffId && toLocal(b.start, tz).date === c.date).flatMap((b) => staffBusySpans(b).map((sp) => ({ ...sp, client: minute(b.start) }))),
    ...(ctx.blocks ?? []).filter((b) => b.staffId === staffId && b.date === c.date).map((b) => ({ start: b.start.getTime(), end: b.end.getTime(), client: null })),
  ];
  const staff = ctx.staff.get(staffId)!;
  const day = dayView(staff.schedule, ctx.location, c.date);
  const shift = day.available.find((i) => i.start <= minute(new Date(from)) && i.end >= minute(new Date(to))) ?? { start: minute(new Date(from)), end: minute(new Date(to)) };
  const dayStartMs = from - (minute(new Date(from)) - shift.start) * MINUTE_MS;
  const dayEndMs = to + (shift.end - minute(new Date(to))) * MINUTE_MS;
  const prior = busy.filter((b) => b.end <= from).sort((a, b) => b.end - a.end)[0];
  const next = busy.filter((b) => b.start >= to).sort((a, b) => a.start - b.start)[0];
  const priorEnd = Math.max(prior?.end ?? -Infinity, dayStartMs);
  const nextStart = Math.min(next?.start ?? Infinity, dayEndMs);
  return {
    before: Math.round((from - priorEnd) / MINUTE_MS),
    after: Math.round((nextStart - to) / MINUTE_MS),
    clientBefore: prior && prior.end === from ? prior.client : null,
    clientAfter: next && next.start === to ? next.client : null,
    dayStart: priorEnd === dayStartMs && from === dayStartMs,
    dayEnd: nextStart === dayEndMs && to === dayEndMs,
  };
}

// The three best times, different from each other (not three starts a
// quarter hour apart with the same stylist), each with why.
export function rankVisits(
  ctx: BookingContext,
  candidates: readonly Candidate[],
  habits: Habits,
  names: ReadonlyMap<string, string>,
  options: { earliest?: boolean; count?: number } = {},
): Ranked[] {
  if (!candidates.length) return [];
  const firstDate = candidates.reduce((d, c) => (c.date < d ? c.date : d), candidates[0].date);
  const scored = candidates.map((c) => {
    const staffId = c.lines[0].staffId;
    const name = names.get(staffId) ?? "the stylist";
    const fit = fitOf(ctx, c);
    const weekday = weekdayOf(c.date) as Weekday;
    const usualStylist = habits.usualStaffId === staffId;
    const usualDay = habits.usualWeekday === weekday;
    const usualPart = habits.usualPart === partOf(c.minute);
    const dayIndex = daysBetween(firstDate, c.date);
    const stylists = new Set(c.lines.map((l) => l.staffId)).size;

    let score = 0;
    if (usualStylist) score += 30;
    if (usualDay) score += 10;
    if (usualPart) score += 8;
    // Snug in the day: next to another client or the start or end of it.
    const snug = (fit.clientBefore !== null || fit.dayStart ? 1 : 0) + (fit.clientAfter !== null || fit.dayEnd ? 1 : 0);
    score += snug * 9;
    // A gap too short to book leaves the stylist idle.
    if (fit.before > 0 && fit.before < SMALL_GAP) score -= 15;
    if (fit.after > 0 && fit.after < SMALL_GAP) score -= 15;
    if (stylists > 1) score -= 10;
    score -= options.earliest ? dayIndex * 40 + c.minute / 15 : dayIndex * 2 + c.minute / 240;

    const phrases: string[] = [];
    if (usualStylist && usualDay) phrases.push(`${name}'s usual ${WEEKDAY_NAMES[weekday]}`);
    else if (usualStylist) phrases.push(`with ${name}, the usual stylist`);
    else if (usualDay && usualPart) phrases.push(`their usual ${WEEKDAY_NAMES[weekday]} ${partOf(c.minute)}`);
    else if (usualDay) phrases.push(`their usual ${WEEKDAY_NAMES[weekday]}`);
    else if (usualPart) phrases.push(`the ${partOf(c.minute)}, when they usually come`);
    // Once the stylist is named, the rest doesn't name them again.
    const whose = usualStylist ? "the" : `${name}'s`;
    if (fit.clientBefore !== null) phrases.push(`right after ${whose} ${formatMinute(fit.clientBefore)} client`);
    else if (fit.clientAfter !== null) phrases.push(`right before ${whose} ${formatMinute(fit.clientAfter)} client`);
    else if (fit.dayStart) phrases.push(usualStylist ? "first thing in the day" : `first thing in ${name}'s day`);
    if ((fit.clientBefore !== null || fit.dayStart) && fit.after >= 60) {
      const free = toLocal(c.end, ctx.location.timeZone).minute;
      phrases.push(`leaves ${formatMinute(free)} onward open`);
    }
    if (stylists > 1) phrases.push(`${[...new Set(c.lines.map((l) => names.get(l.staffId) ?? "another stylist"))].join(" then ")}`);
    return { ...c, score, phrases };
  });

  const order = [...scored].sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime());
  const earliestStart = Math.min(...candidates.map((c) => c.start.getTime()));
  const picked: typeof order = [];
  for (const c of order) {
    if (picked.length >= (options.count ?? 3)) break;
    const tooClose = picked.some((p) => p.lines[0].staffId === c.lines[0].staffId && p.date === c.date && Math.abs(p.minute - c.minute) < 90);
    if (!tooClose) picked.push(c);
  }
  return picked.map(({ phrases, ...c }) => {
    const words = [...phrases];
    if (c.start.getTime() === earliestStart && words.length < 2) words.unshift("the earliest time");
    if (!words.length) words.push(`fits ${names.get(c.lines[0].staffId) ?? "the stylist"}'s day without a gap`);
    const reason = words.slice(0, 2).join(", ");
    return { ...c, reason: reason[0].toUpperCase() + reason.slice(1) };
  });
}
