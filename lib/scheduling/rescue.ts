// Sick-day rescue (pure): a plan for every visit of a stylist who's out,
// all day or from a time. For each visit, in order of how little it asks
// of the client:
//   1. the same time with a qualified stylist at the same level,
//   2. a qualified stylist at another level at the same time, then anyone
//      qualified up to an hour later (SHIFT_STEPS),
//   3. another day: the next openings with their own stylist, then with a
//      stylist at the same level,
// and always "leave it and call the client". Clients who only see this
// stylist get only their stylist's openings; those who prefer them start
// on a reschedule. Every option passes the booking rules (checkMoves) at
// each stylist's own length for the service, against the plan so far, so
// two clients are never given the same time. Nobody is moved earlier or
// into the past, and visits that have started stay where they are.

import { checkMoves, itemEnd, pickResource, type BookedItem, type BookingContext, type BookingProblem, type ServiceTiming } from "./booking.ts";
import { addDays, fromLocal, toLocal, type LocalDate } from "./time.ts";

export type Level = "artisan" | "senior" | "master" | null;

export type RescueStylist = { id: string; firstName: string; level: Level };

export type RescueVisit = {
  appointmentId: string;
  clientId: string | null;
  // Can be moved: booked or confirmed. Others (in the chair) are shown only.
  movable: boolean;
  items: (BookedItem & { id: string })[];
  // The client's preferred stylist, and whether they only see them.
  preferredStaffId: string | null;
  onlySees: boolean;
  // When it was booked: visits starting together are planned in booking
  // order, so whoever booked first gets the first pick.
  bookedAt?: Date;
};

export type RescueMove = { itemId: string; appointmentId: string; staffId: string; resourceId: string | null; start: Date; timing: ServiceTiming };

export type RescueKind = "cover" | "shift" | "reschedule";

export type RescueOption = {
  kind: RescueKind;
  // The stylist doing the out stylist's part, and when the visit starts.
  staffId: string;
  date: LocalDate;
  start: Date;
  // Minutes later than booked, on the same day (cover and shift).
  shift: number;
  sameLevel: boolean;
  moves: RescueMove[];
};

export type RescueLine = {
  visit: RescueVisit;
  // Best first; the choice is an index, or null to leave it and call.
  options: RescueOption[];
  choice: number | null;
  // Why the line starts where it does.
  note: "in_chair" | "only_sees" | "prefers" | "none_fit" | null;
};

export const SHIFT_STEPS = [15, 30, 45, 60];
export const RESCHEDULE_DAYS = 14;
const STEP = 15;
// Openings with their own stylist, then with others at the same level.
const OWN_OPENINGS = 2;
const PEER_OPENINGS = 2;
// At most this many on the same day (the closest first).
const SAME_DAY_OPTIONS = 4;

export type RescueInput = {
  staffId: string;
  date: LocalDate;
  // Out from this instant to the end of the day.
  from: Date;
  visits: RescueVisit[];
  stylists: RescueStylist[];
  // The stylist's length for a service: their usual time where it's
  // trusted, else their own or the menu's.
  timingOf: (staffId: string, serviceId: string) => ServiceTiming | undefined;
  now: Date;
  // Later dates to look for openings on (the context must cover them).
  days?: number;
};

const overlapsOut = (item: BookedItem, from: Date) => itemEnd(item).getTime() > from.getTime();

// The visits a call-out touches: the stylist's items from `from` on, by
// start, then booked first, always in the same order.
export function affectedVisits<T extends RescueVisit>(visits: readonly T[], staffId: string, from: Date): T[] {
  return visits
    .filter((v) => v.items.some((i) => i.staffId === staffId && overlapsOut(i, from)))
    .sort(
      (a, b) =>
        a.items[0].start.getTime() - b.items[0].start.getTime() ||
        (a.bookedAt?.getTime() ?? 0) - (b.bookedAt?.getTime() ?? 0) ||
        a.appointmentId.localeCompare(b.appointmentId),
    );
}

// The calendar with these moves made: each item at its new place and length.
export function withMoves(ctx: BookingContext, moves: readonly RescueMove[]): BookingContext {
  const byId = new Map(moves.map((m) => [m.itemId, m]));
  return {
    ...ctx,
    booked: ctx.booked.map((b) => {
      const m = b.id ? byId.get(b.id) : undefined;
      return m ? { ...b, ...m.timing, staffId: m.staffId, resourceId: m.resourceId, start: m.start } : b;
    }),
  };
}

// Checks moves at their new lengths: the booking rules for each, and that
// a longer service doesn't run into the client's next one.
export function checkRescueMoves(ctx: BookingContext, moves: readonly RescueMove[]): BookingProblem[][] {
  const lengthened: BookingContext = {
    ...ctx,
    booked: ctx.booked.map((b) => {
      const m = moves.find((x) => x.itemId === b.id);
      return m ? { ...b, ...m.timing } : b;
    }),
  };
  const { problems } = checkMoves(lengthened, moves);
  const after = withMoves(ctx, moves);
  return moves.map((m, i) => {
    if (problems[i].length) return problems[i];
    const mine = after.booked.find((b) => b.id === m.itemId)!;
    const before = ctx.booked.find((b) => b.id === m.itemId)!;
    const clash = after.booked.some((o) => {
      if (o.appointmentId !== mine.appointmentId || o.id === mine.id) return false;
      const old = ctx.booked.find((b) => b.id === o.id)!;
      // Only a new overlap within the visit counts.
      const was = before.start < itemEnd(old) && old.start < itemEnd(before);
      return !was && mine.start < itemEnd(o) && o.start < itemEnd(mine);
    });
    return clash ? [{ code: "staff_double_booked" as const }] : [];
  });
}

// One option: the out stylist's items to `staffId`, every item of the
// visit moved by `delta` (and `days`), others keeping their stylist.
function tryOption(
  ctx: BookingContext,
  visit: RescueVisit,
  input: RescueInput,
  staffId: string,
  start: Date,
): RescueMove[] | null {
  const tz = ctx.location.timeZone;
  const delta = start.getTime() - visit.items[0].start.getTime();
  const moves: RescueMove[] = [];
  const placed: BookedItem[] = [];
  for (const item of visit.items) {
    const out = item.staffId === input.staffId;
    const to = out ? staffId : item.staffId;
    if (!ctx.staff.get(to)?.serviceIds.has(item.serviceId)) return null;
    // A new stylist takes their own time; everyone else keeps the booked length.
    const own = { activeMinutes: item.activeMinutes, processingMinutes: item.processingMinutes, finishingMinutes: item.finishingMinutes };
    const timing = out && to !== input.staffId ? (input.timingOf(to, item.serviceId) ?? own) : own;
    const at = new Date(item.start.getTime() + delta);
    if (toLocal(at, tz).date !== toLocal(start, tz).date) return null;
    const draft: BookedItem = { ...item, ...timing, staffId: to, start: at };
    const resourceId = item.resourceId ? pickResource(ctx, draft, item.resourceId, placed) : null;
    if (item.resourceId && !resourceId) return null;
    placed.push({ ...draft, resourceId });
    moves.push({ itemId: item.id, appointmentId: visit.appointmentId, staffId: to, resourceId, start: at, timing });
  }
  // Nothing changes: not an option.
  if (moves.every((m, i) => m.staffId === visit.items[i].staffId && m.start.getTime() === visit.items[i].start.getTime())) return null;
  return checkRescueMoves(ctx, moves).every((p) => p.length === 0) ? moves : null;
}

const option = (kind: RescueKind, staffId: string, start: Date, shift: number, sameLevel: boolean, moves: RescueMove[], tz: string): RescueOption => ({
  kind,
  staffId,
  date: toLocal(start, tz).date,
  start,
  shift,
  sameLevel,
  moves,
});

// Every option for one visit, best first, on the calendar as planned so far.
export function rescueOptions(ctx: BookingContext, visit: RescueVisit, input: RescueInput): RescueOption[] {
  const tz = ctx.location.timeZone;
  const level = input.stylists.find((s) => s.id === input.staffId)?.level ?? null;
  const others = input.stylists.filter((s) => s.id !== input.staffId && ctx.staff.get(s.id)?.isActive);
  const peers = others.filter((s) => level !== null && s.level === level);
  const booked = visit.items[0].start;
  const options: RescueOption[] = [];

  if (!visit.onlySees) {
    // 1 and 2: the same day, at the same time or a little later.
    for (const shift of [0, ...SHIFT_STEPS]) {
      const start = new Date(booked.getTime() + shift * 60_000);
      if (start.getTime() < input.now.getTime()) continue;
      for (const s of [...peers, ...others.filter((o) => !peers.includes(o))]) {
        // Each stylist once: their earliest time.
        if (options.some((o) => o.staffId === s.id)) continue;
        const moves = tryOption(ctx, visit, input, s.id, start);
        if (!moves) continue;
        const same = peers.includes(s);
        options.push(option(shift === 0 ? "cover" : "shift", s.id, start, shift, same, moves, tz));
      }
    }
    options.splice(SAME_DAY_OPTIONS);
  }

  // 3: another day, nearest the time they booked.
  const minute = toLocal(booked, tz).minute;
  const days = input.days ?? RESCHEDULE_DAYS;
  const later = (staffId: string, count: number, taken: Set<LocalDate>) => {
    const found: RescueOption[] = [];
    for (let d = 1; d <= days && found.length < count; d++) {
      const date = addDays(input.date, d);
      if (taken.has(date)) continue;
      const starts: number[] = [];
      for (let m = 0; m < 24 * 60; m += STEP) starts.push(m);
      starts.sort((a, b) => Math.abs(a - minute) - Math.abs(b - minute) || a - b);
      for (const m of starts) {
        const start = fromLocal(date, m, tz);
        if (!start || start.getTime() < input.now.getTime()) continue;
        const moves = tryOption(ctx, visit, input, staffId, start);
        if (!moves) continue;
        found.push(option("reschedule", staffId, start, 0, staffId === input.staffId || peers.some((p) => p.id === staffId), moves, tz));
        taken.add(date);
        break;
      }
    }
    return found;
  };
  options.push(...later(input.staffId, OWN_OPENINGS, new Set()));
  if (!visit.onlySees) {
    const peerFound: RescueOption[] = [];
    for (const p of peers) peerFound.push(...later(p.id, 1, new Set()));
    peerFound.sort((a, b) => a.start.getTime() - b.start.getTime());
    options.push(...peerFound.slice(0, PEER_OPENINGS));
  }
  return options;
}

// The whole plan: each visit's options against the plan so far, starting
// on the best (or a reschedule for clients who'd rather wait).
// Same day before another day; then the smaller shift, the same level, and
// the client's own stylist before others.
function order(a: RescueOption, b: RescueOption, absent: string) {
  const day = (o: RescueOption) => (o.kind === "reschedule" ? 1 : 0);
  return (
    day(a) - day(b) ||
    (day(a) ? (a.staffId === absent ? 0 : 1) - (b.staffId === absent ? 0 : 1) || a.start.getTime() - b.start.getTime() : a.shift - b.shift || Number(b.sameLevel) - Number(a.sameLevel))
  );
}

const sameOption = (a: RescueOption, b: RescueOption) => a.staffId === b.staffId && a.start.getTime() === b.start.getTime();

export function planRescue(ctx: BookingContext, input: RescueInput): RescueLine[] {
  let calendar = ctx;
  return affectedVisits(input.visits, input.staffId, input.from).map((visit): RescueLine => {
    if (!visit.movable) return { visit, options: [], choice: null, note: "in_chair" };
    // Options on the calendar as it is (so staff can swap clients around),
    // and those that fit around the clients placed before this one.
    const base = rescueOptions(ctx, visit, input);
    const around = calendar === ctx ? [] : rescueOptions(calendar, visit, input).filter((o) => !base.some((b) => sameOption(o, b)));
    const options = [...base, ...around].sort((a, b) => order(a, b, input.staffId));
    const fits = (i: number) => checkRescueMoves(calendar, options[i].moves).every((p) => p.length === 0);
    const prefers = visit.preferredStaffId === input.staffId;
    const wanted = (o: RescueOption) => !(visit.onlySees || prefers) || (o.kind === "reschedule" && o.staffId === input.staffId);
    let choice: number | null = options.findIndex((o, i) => wanted(o) && fits(i));
    if (choice < 0) choice = visit.onlySees ? null : options.findIndex((_, i) => fits(i));
    if (choice !== null && choice < 0) choice = null;
    if (choice !== null) calendar = withMoves(calendar, options[choice].moves);
    const note = visit.onlySees ? "only_sees" : prefers ? "prefers" : options.length ? null : "none_fit";
    return { visit, options, choice, note };
  });
}

// The moves for the chosen options, and any lines whose choice no longer
// fits alongside the others (after staff change a line).
export function chosenMoves(lines: readonly RescueLine[], choices: readonly (number | null)[]): RescueMove[] {
  return lines.flatMap((l, i) => {
    const c = choices[i];
    return c === null || c === undefined ? [] : (l.options[c]?.moves ?? []);
  });
}

export function planProblems(ctx: BookingContext, lines: readonly RescueLine[], choices: readonly (number | null)[]): number[] {
  const moves = chosenMoves(lines, choices);
  const problems = checkRescueMoves(ctx, moves);
  const bad = new Set(moves.filter((_, i) => problems[i].length).map((m) => m.appointmentId));
  return lines.flatMap((l, i) => (bad.has(l.visit.appointmentId) ? [i] : []));
}
