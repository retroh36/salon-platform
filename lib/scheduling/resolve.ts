// Conflicts in a day's plan, and ranked fixes for them.
//
// Pure functions over the day's calendar (./load.ts) and what staff have
// reported (schedule_disruptions): a stylist running over, a client running
// late, a stylist out for the rest of the day. Double-bookings are found in
// the calendar itself.
//
// The effective calendar is the real one with reports applied: an overrun
// makes its item end later (the stylist is busy longer); a late client's
// visit starts later. A conflict is a booked item that passed the booking
// rules (./booking.ts) on the real calendar but fails on the effective one,
// or one that's double-booked outright.
//
// Fixes move booked items, never ones whose client has checked in or out,
// and never earlier than booked or into the past. Up to three, ranked by
// least disruption:
//   1. fewest items left without a place,
//   2. fewest clients moved,
//   3. the smallest total delay, counting a move to another stylist as
//      STYLIST_CHANGE_MINUTES of delay (so the same stylist a little later
//      beats another stylist straight away, but not a long wait).
// Group bookings stay together when they can: splitting a group (moving
// some guests and not others, or by different amounts) costs as much as
// moving every guest plus GROUP_SPLIT_MINUTES each, so the whole party
// moves by the same amount if it fits within about that much.
// Each candidate place is checked with the booking rules, so processing
// gaps are used where a client fits in them. Moving a client later can push
// the same stylist's next client along (and so on). Every option is checked
// again as a whole before it's returned.

import type { AppointmentStatus } from "../appointments.ts";
import type { ItemChange, Placement } from "./ai-actions.ts";
import { isAvailable } from "./availability.ts";
import { MAX_BLOCK_SHIFT, MOVABLE_KINDS, type TimeBlockKind } from "./blocks.ts";
import { busyDuring, checkItem, checkMoves, itemEnd, pickResource, type BlockedTime, type BookedItem, type BookingContext, type BookingProblem } from "./booking.ts";

const MINUTE = 60_000;
const STEP = 5;
export const MAX_SHIFT_MINUTES = 180;
export const STYLIST_CHANGE_MINUTES = 30;
const MAX_OPTIONS = 3;
// States the search looks at per conflict before settling for what it has.
const SEARCH_LIMIT = 800;
// How many clients one move can push along.
const MAX_BUMPS = 2;

export type Disruption =
  | { id: string; kind: "overrun"; itemId: string; minutes: number }
  // Not reported: Denise expects it, because the stylist usually takes this
  // much longer for the service than it's booked for (lib/insights/);
  // `estimated` when that's from check-in to checkout times, not taps.
  | { id: string; kind: "likely_overrun"; itemId: string; minutes: number; estimated?: boolean }
  | { id: string; kind: "client_late"; appointmentId: string; minutes: number }
  | { id: string; kind: "call_out"; staffId: string; from: Date };

export type ConflictKind = Disruption["kind"] | "double_booking";

// A lunch or break moved to make room (never training, meetings or
// personal time).
export type BlockMove = { blockId: string; date: string; staffId: string; kind: TimeBlockKind; from: { start: Date; end: Date }; to: { start: Date; end: Date } };

// Moving a lunch or break counts like this many minutes of delay, plus the
// minutes it moves.
export const BLOCK_MOVE_MINUTES = 10;
// Per guest, for splitting a group booking (on top of a client moved for
// each guest but one).
export const GROUP_SPLIT_MINUTES = 60;

export type FixOption = {
  moves: ItemChange[];
  blockMoves: BlockMove[];
  // Items it couldn't find a place for today.
  unresolved: string[];
  clientsMoved: number;
  shiftMinutes: number;
  stylistChanges: number;
  score: number;
};

export type Conflict = {
  // Stable name for the problem, e.g. "overrun:<report id>".
  subject: string;
  kind: ConflictKind;
  disruptionId: string | null;
  // The stylist it's about: running over, out, double-booked, or the late
  // client's.
  staffId: string | null;
  minutes: number | null;
  // A likely overrun known from check-in to checkout times, not taps.
  estimated?: boolean;
  // What caused it: the overrunning item, the late visit's items, or both
  // double-booked items.
  causeItemIds: string[];
  // Items that need a new place.
  displaced: string[];
  // Items caught up in it that can't be moved: the client's checked in.
  stuck: string[];
  options: FixOption[];
};

export type Day = {
  // The day's calendar. A call-out's time off is in the stylist's schedule.
  ctx: BookingContext;
  // Status of each appointment on the calendar.
  statuses: ReadonlyMap<string, AppointmentStatus>;
  disruptions: readonly Disruption[];
  now: Date;
  // Appointment id -> its group booking.
  groups?: ReadonlyMap<string, string>;
};

export function isMovable(status: AppointmentStatus | undefined): boolean {
  return status === "booked" || status === "confirmed";
}

// Reports that still change the plan: overruns of visits in progress, and
// late clients who haven't arrived.
export function activeDisruptions(day: Pick<Day, "ctx" | "statuses" | "disruptions">): Disruption[] {
  const appointmentOf = new Map(day.ctx.booked.filter((b) => b.id).map((b) => [b.id!, b.appointmentId]));
  return day.disruptions.filter((d) => {
    if (d.kind === "overrun") {
      const appointmentId = appointmentOf.get(d.itemId);
      return appointmentId !== undefined && day.statuses.get(appointmentId!) === "checked_in";
    }
    if (d.kind === "client_late") return isMovable(day.statuses.get(d.appointmentId));
    // Expected overruns: visits that haven't started (or are just under way).
    if (d.kind === "likely_overrun") {
      const appointmentId = appointmentOf.get(d.itemId);
      const status = appointmentId === undefined ? undefined : day.statuses.get(appointmentId!);
      return status === "booked" || status === "confirmed" || status === "checked_in";
    }
    return true;
  });
}

// The stylist stays busy `minutes` longer at the end of the item.
function extend(item: BookedItem, minutes: number): BookedItem {
  return item.processingMinutes > 0 ? { ...item, finishingMinutes: item.finishingMinutes + minutes } : { ...item, activeMinutes: item.activeMinutes + minutes };
}

// The calendar as it will really go, with the reports applied.
export function effectiveCalendar(ctx: BookingContext, disruptions: readonly Disruption[]): BookingContext {
  const overruns = new Map<string, number>();
  const late = new Map<string, number>();
  for (const d of disruptions) {
    if (d.kind === "overrun" || d.kind === "likely_overrun") overruns.set(d.itemId, Math.max(d.minutes, overruns.get(d.itemId) ?? 0));
    if (d.kind === "client_late") late.set(d.appointmentId, d.minutes);
  }
  if (!overruns.size && !late.size) return ctx;
  return {
    ...ctx,
    booked: ctx.booked.map((b) => {
      let item = b;
      const over = b.id ? overruns.get(b.id) : undefined;
      if (over) item = extend(item, over);
      const lateBy = b.appointmentId ? late.get(b.appointmentId) : undefined;
      if (lateBy) item = { ...item, start: new Date(item.start.getTime() + lateBy * MINUTE) };
      return item;
    }),
  };
}

const CLASHES = new Set<BookingProblem["code"]>(["staff_double_booked", "resource_in_use"]);

// Problems that make a booked item a conflict: clashes and unavailable
// stylists. (A service the stylist stopped offering isn't today's problem.)
function problemsOf(ctx: BookingContext, item: BookedItem): BookingProblem[] {
  const check = checkItem(ctx, { id: item.id, serviceId: item.serviceId, staffId: item.staffId, resourceId: item.resourceId, start: item.start, timing: item });
  return check.valid ? [] : check.problems.filter((p) => CLASHES.has(p.code) || p.code === "staff_unavailable");
}

const ceilToStep = (ms: number) => Math.ceil(ms / (STEP * MINUTE)) * STEP * MINUTE;

// Every conflict on the day, with up to three fixes each.
export function findConflicts(day: Day): Conflict[] {
  const active = activeDisruptions(day);
  const plain = day.ctx;
  const eff = effectiveCalendar(plain, active);
  const items = plain.booked.filter((b): b is BookedItem & { id: string } => !!b.id);
  const byId = new Map(items.map((b) => [b.id, b]));
  const movable = (id: string) => isMovable(day.statuses.get(byId.get(id)?.appointmentId ?? ""));
  const plainProblems = new Map(items.map((b) => [b.id, problemsOf(plain, b)]));

  const conflicts: Conflict[] = [];
  const explained = new Set<string>();

  for (const d of active) {
    const effOfD = effectiveCalendar(plain, [d]);
    const effItems = new Map(effOfD.booked.filter((b) => b.id).map((b) => [b.id!, b]));
    // Items fine before this report and not after it.
    const broken = (exclude: Set<string>) =>
      items.filter((b) => !exclude.has(b.id) && plainProblems.get(b.id)!.length === 0 && problemsOf(effOfD, effItems.get(b.id)!).length > 0).map((b) => b.id);

    if (d.kind === "overrun" || d.kind === "likely_overrun") {
      const cause = byId.get(d.itemId);
      if (!cause) continue;
      const hit = broken(new Set([d.itemId]));
      if (!hit.length) continue;
      hit.forEach((id) => explained.add(id));
      conflicts.push(
        resolveConflict(day, eff, {
          subject: `${d.kind === "overrun" ? "overrun" : "likely"}:${d.id}`,
          kind: d.kind,
          disruptionId: d.id,
          staffId: cause.staffId,
          minutes: d.minutes,
          ...(d.kind === "likely_overrun" && d.estimated ? { estimated: true } : {}),
          causeItemIds: [d.itemId],
          displaced: hit.filter(movable),
          stuck: hit.filter((id) => !movable(id)),
        }),
      );
    } else if (d.kind === "client_late") {
      const visit = items.filter((b) => b.appointmentId === d.appointmentId).sort((a, b) => a.start.getTime() - b.start.getTime());
      if (!visit.length) continue;
      visit.forEach((b) => explained.add(b.id));
      broken(new Set(visit.map((b) => b.id))).forEach((id) => explained.add(id));
      conflicts.push(
        resolveConflict(day, eff, {
          subject: `late:${d.id}`,
          kind: "client_late",
          disruptionId: d.id,
          staffId: visit[0].staffId,
          minutes: d.minutes,
          causeItemIds: visit.map((b) => b.id),
          displaced: visit.map((b) => b.id),
          stuck: [],
        }),
      );
    } else {
      // The time off is already in the schedule, so the plain calendar
      // shows the stylist's items as unavailable.
      const hit = items
        .filter(
          (b) =>
            b.staffId === d.staffId &&
            itemEnd(b) > d.from &&
            plainProblems.get(b.id)!.some((p) => p.code === "staff_unavailable" && p.reason === "time_off"),
        )
        .map((b) => b.id);
      if (!hit.length) continue;
      hit.forEach((id) => explained.add(id));
      conflicts.push(
        resolveConflict(day, eff, {
          subject: `call_out:${d.id}`,
          kind: "call_out",
          disruptionId: d.id,
          staffId: d.staffId,
          minutes: null,
          causeItemIds: [],
          displaced: hit.filter(movable),
          stuck: hit.filter((id) => !movable(id)),
        }),
      );
    }
  }

  // Double-bookings already on the calendar, one conflict per pair.
  const pairs = new Set<string>();
  for (const b of items) {
    for (const p of plainProblems.get(b.id)!) {
      if (!CLASHES.has(p.code) || !("conflictWith" in p) || !p.conflictWith || !byId.has(p.conflictWith)) continue;
      const pair = [b.id, p.conflictWith].sort();
      const key = pair.join(":");
      if (pairs.has(key) || pair.every((id) => explained.has(id))) continue;
      pairs.add(key);
      const other = byId.get(p.conflictWith)!;
      conflicts.push(
        resolveConflict(day, eff, {
          subject: `double:${key}`,
          kind: "double_booking",
          disruptionId: null,
          staffId: p.code === "staff_double_booked" ? b.staffId : null,
          minutes: null,
          causeItemIds: pair,
          // Either one can move; the search tries each.
          displaced: pair.filter(movable),
          stuck: movable(b.id) || movable(other.id) ? [] : pair,
        }),
      );
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

type Pending = { itemId: string; earliest: number };

type State = {
  // Item id -> its new place.
  placed: Map<string, Placement>;
  // "blockId:date" -> a lunch or break moved.
  blockMoves: Map<string, BlockMove>;
  pending: Pending[];
  unresolved: string[];
  // Lower bound on the final score.
  estimate: number;
  score: number;
};

type Search = {
  day: Day;
  eff: BookingContext;
  // The real (database) items, for "from" and for measuring shifts.
  real: Map<string, BookedItem & { id: string }>;
  // The effective items: timing and (for late clients) start.
  effective: Map<string, BookedItem & { id: string }>;
  pinned: Set<string>;
  earliestStart: number;
};

function resolveConflict(day: Day, eff: BookingContext, conflict: Omit<Conflict, "options">): Conflict {
  const search: Search = {
    day,
    eff,
    real: new Map(day.ctx.booked.filter((b): b is BookedItem & { id: string } => !!b.id).map((b) => [b.id, b])),
    effective: new Map(eff.booked.filter((b): b is BookedItem & { id: string } => !!b.id).map((b) => [b.id, b])),
    pinned: new Set(conflict.causeItemIds),
    earliestStart: ceilToStep(day.now.getTime()),
  };

  let options: FixOption[] = [];
  if (conflict.kind === "double_booking") {
    // Move one or the other; the best options from either. On a tie, the
    // later client moves.
    const later = [...conflict.displaced].sort((a, b) => search.effective.get(b)!.start.getTime() - search.effective.get(a)!.start.getTime());
    for (const id of later) {
      const other = conflict.causeItemIds.find((c) => c !== id)!;
      options.push(...searchFixes({ ...search, pinned: new Set([other]) }, [id]));
    }
  } else if (conflict.kind === "client_late") {
    // The visit's first item anchors the rest of it.
    const first = conflict.displaced[0];
    options = searchFixes({ ...search, pinned: new Set() }, [first], conflict.displaced);
  } else {
    options = searchFixes(search, conflict.displaced);
  }

  const seen = new Set<string>();
  options = options
    // Ties keep the stylist, then the time.
    .sort((a, b) => a.score - b.score || a.stylistChanges - b.stylistChanges || a.shiftMinutes - b.shiftMinutes)
    .filter((o) => {
      const key =
        o.moves.map((m) => `${m.itemId}>${m.to.staffId}@${m.to.start.getTime()}`).sort().join("|") +
        `|${o.unresolved.sort().join(",")}|${o.blockMoves.map((m) => `${m.blockId}@${m.to.start.getTime()}`).join(",")}`;
      return !seen.has(key) && seen.add(key);
    })
    .slice(0, MAX_OPTIONS);
  return { ...conflict, options };
}

// Up to three fixes placing `displaced` (and anything they push along).
// `alsoMoving` are items that move whatever the fix (a late visit's items).
function searchFixes(s: Search, displaced: string[], alsoMoving: string[] = []): FixOption[] {
  const startPending = displaced
    .map((id) => ({ itemId: id, earliest: Math.max(s.effective.get(id)!.start.getTime(), s.earliestStart) }))
    .sort((a, b) => a.earliest - b.earliest);
  const initial: State = { placed: new Map(), blockMoves: new Map(), pending: startPending, unresolved: [], estimate: 0, score: 0 };
  initial.estimate = estimate(s, initial);

  const heap = new Heap<State>((a, b) => a.estimate - b.estimate || b.placed.size - a.placed.size);
  heap.push(initial);
  const found: FixOption[] = [];
  let explored = 0;

  while (heap.size && found.length < MAX_OPTIONS * 2 && explored < SEARCH_LIMIT) {
    const state = heap.pop()!;
    explored++;
    if (!state.pending.length) {
      const option = finish(s, state, alsoMoving);
      if (option) found.push(option);
      continue;
    }
    for (const next of expand(s, state)) heap.push(next);
  }

  // Out of time: finish the most promising partial plans greedily.
  for (let tries = 0; found.length < MAX_OPTIONS && heap.size && tries < 10; tries++) {
    let state = heap.pop()!;
    while (state.pending.length) state = expand(s, state).sort((a, b) => a.estimate - b.estimate)[0];
    const option = finish(s, state, alsoMoving);
    if (option) found.push(option);
  }
  return found;
}

// The calendar for checking a place: placed items in their new places, and
// pending items (and `without`) off it.
function calendarFor(s: Search, state: State, without: Set<string>): BookingContext {
  const pending = new Set(state.pending.map((p) => p.itemId));
  const booked: BookedItem[] = [];
  for (const b of s.eff.booked) {
    if (b.id && (pending.has(b.id) || without.has(b.id))) continue;
    const place = b.id ? state.placed.get(b.id) : undefined;
    booked.push(place ? { ...b, ...place } : b);
  }
  return { ...s.eff, booked, blocks: movedBlocks(s.eff.blocks ?? [], state.blockMoves) };
}

const blockKey = (b: { blockId: string; date: string }) => `${b.blockId}:${b.date}`;

function movedBlocks(blocks: readonly BlockedTime[], moves: ReadonlyMap<string, BlockMove>): BlockedTime[] {
  return blocks.map((b) => {
    const m = moves.get(blockKey(b));
    return m ? { ...b, start: m.to.start, end: m.to.end } : b;
  });
}

type Candidate = { moves: Map<string, Placement>; bumped: string[]; blockMove?: BlockMove };

// Ways to place the first pending item: for each stylist who could take
// it, the earliest place that's free, plus (for its own stylist) its
// earliest time pushing the next clients along.
function expand(s: Search, state: State): State[] {
  const [first, ...rest] = state.pending;
  const anchor = s.effective.get(first.itemId)!;
  // The rest of the visit moves with it: later services keep their gap.
  const group = s.eff.booked.filter(
    (b): b is BookedItem & { id: string } =>
      !!b.id && b.appointmentId === anchor.appointmentId && b.start.getTime() >= anchor.start.getTime() && !state.placed.has(b.id),
  );
  const groupIds = new Set(group.map((b) => b.id));
  const stylists = [anchor.staffId, ...[...s.eff.staff.values()].filter((st) => st.id !== anchor.staffId && st.isActive && st.serviceIds.has(anchor.serviceId)).map((st) => st.id)];
  const latest = first.earliest + MAX_SHIFT_MINUTES * MINUTE;

  const candidates: Candidate[] = [];
  for (const staffId of stylists) {
    // With their own stylist, a client can push the next ones along, at the
    // first time only those clients are in the way.
    let mayPush = staffId === anchor.staffId;
    // A lunch or break in the way can shift, once per stylist.
    let mayShiftBlock = true;
    for (let t = first.earliest; t <= latest; t += STEP * MINUTE) {
      const delta = t - anchor.start.getTime();
      const moves = new Map<string, Placement>();
      for (const b of group) {
        const staff = b.id === anchor.id || b.staffId === anchor.staffId ? staffId : b.staffId;
        moves.set(b.id, { staffId: staff, resourceId: b.resourceId ?? null, start: new Date(b.start.getTime() + delta) });
      }
      const bumped: string[] = [];
      let fits = false;
      for (let round = 0; round <= MAX_BUMPS; round++) {
        const problems = tryPlace(s, state, group, moves, new Set([...groupIds, ...bumped]));
        if (!problems.length) {
          fits = true;
          break;
        }
        const push = mayPush ? bumpable(s, state, problems, staffId, anchor, bumped) : null;
        if (!push) {
          if (mayShiftBlock && !bumped.length && problems.length === 1 && problems[0].code === "staff_blocked") {
            mayShiftBlock = false;
            const blockMove = shiftBlock(s, state, group, moves, new Set(groupIds), problems[0]);
            if (blockMove) candidates.push({ moves: new Map([...moves].map(([k, v]) => [k, { ...v }])), bumped: [], blockMove });
          }
          break;
        }
        bumped.push(push);
      }
      if (bumped.length) mayPush = false;
      if (fits) {
        candidates.push({ moves, bumped });
        if (!bumped.length) break; // the earliest free place for this stylist
      }
    }
  }

  const together = partyMove(s, state, first, anchor, latest);
  if (together) candidates.push(together);

  const states = candidates.map((c) => {
    const placed = new Map(state.placed);
    for (const [id, place] of c.moves) placed.set(id, place);
    const blockMoves = new Map(state.blockMoves);
    if (c.blockMove) blockMoves.set(blockKey(c.blockMove), c.blockMove);
    const pending = [
      ...rest.filter((p) => !c.moves.has(p.itemId)),
      ...c.bumped.map((id) => ({ itemId: id, earliest: Math.max(s.effective.get(id)!.start.getTime(), s.earliestStart) })),
    ].sort((a, b) => a.earliest - b.earliest);
    return withScores(s, { placed, blockMoves, pending, unresolved: state.unresolved, estimate: 0, score: 0 });
  });
  // Leaving it where it is (unsolved) is always possible, and always last.
  states.push(withScores(s, { placed: state.placed, blockMoves: state.blockMoves, pending: rest, unresolved: [...state.unresolved, first.itemId], estimate: 0, score: 0 }));
  return states;
}

// The anchor's whole group booking moved by the same amount, at the
// earliest time every guest fits with their own stylist: keeping the party
// together. Null if it isn't in a group, or a guest can't move.
function partyMove(s: Search, state: State, first: Pending, anchor: BookedItem, latest: number): Candidate | null {
  const groupId = s.day.groups?.get(anchor.appointmentId!);
  if (!groupId) return null;
  const party = s.eff.booked
    .filter((b): b is BookedItem & { id: string } => !!b.id && s.day.groups!.get(b.appointmentId!) === groupId)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (party.some((b) => state.placed.has(b.id) || s.pinned.has(b.id) || !isMovable(s.day.statuses.get(b.appointmentId!)))) return null;
  if (new Set(party.map((b) => b.appointmentId)).size < 2) return null;
  const off = new Set(party.map((b) => b.id));
  // From where each guest is booked, so a late guest's party moves with them.
  const booked = (b: BookedItem & { id: string }) => s.real.get(b.id)!.start.getTime();
  for (let t = first.earliest; t <= latest; t += STEP * MINUTE) {
    const delta = t - booked(anchor as BookedItem & { id: string });
    if (delta === 0 || party.some((b) => booked(b) + delta < s.earliestStart)) continue;
    const moves = new Map<string, Placement>(party.map((b) => [b.id, { staffId: b.staffId, resourceId: b.resourceId ?? null, start: new Date(booked(b) + delta) }]));
    if (!tryPlace(s, state, party, moves, off).length) return { moves, bumped: [] };
  }
  return null;
}

// Problems with putting the group in its new places.
function tryPlace(s: Search, state: State, group: (BookedItem & { id: string })[], moves: Map<string, Placement>, off: Set<string>): BookingProblem[] {
  const ctx = calendarFor(s, state, off);
  const accepted: BookedItem[] = [];
  for (const b of group) {
    const to = moves.get(b.id)!;
    const draft: BookedItem = { ...b, staffId: to.staffId, start: to.start };
    const resourceId = b.resourceId ? pickResource(ctx, draft, b.resourceId, accepted) : null;
    if (b.resourceId && !resourceId) return [{ code: "no_free_resource" }];
    to.resourceId = resourceId;
    const check = checkItem(ctx, { id: b.id, serviceId: b.serviceId, staffId: to.staffId, resourceId, start: to.start, timing: b }, accepted);
    if (!check.valid) return check.problems;
    accepted.push(check.item);
  }
  return [];
}

// Moving the lunch or break in the way by up to MAX_BLOCK_SHIFT minutes,
// nearest first, if that lets the group fit: within the stylist's hours,
// and clear of their other clients and blocks.
function shiftBlock(
  s: Search,
  state: State,
  group: (BookedItem & { id: string })[],
  moves: Map<string, Placement>,
  off: Set<string>,
  problem: Extract<BookingProblem, { code: "staff_blocked" }>,
): BlockMove | null {
  if (!MOVABLE_KINDS.has(problem.kind)) return null;
  const key = blockKey(problem);
  if (state.blockMoves.has(key)) return null;
  const block = (s.eff.blocks ?? []).find((b) => blockKey(b) === key);
  const schedule = s.eff.staff.get(block?.staffId ?? "")?.schedule;
  if (!block || !schedule) return null;
  const length = (block.end.getTime() - block.start.getTime()) / MINUTE;
  for (let d = STEP; d <= MAX_BLOCK_SHIFT; d += STEP) {
    for (const shift of [d, -d]) {
      const to = { start: new Date(block.start.getTime() + shift * MINUTE), end: new Date(block.end.getTime() + shift * MINUTE) };
      if (!isAvailable(schedule, s.eff.location, to.start, length).available) continue;
      const move: BlockMove = { blockId: block.blockId, date: block.date, staffId: block.staffId, kind: block.kind, from: { start: block.start, end: block.end }, to };
      const trial: State = { ...state, blockMoves: new Map(state.blockMoves).set(key, move) };
      const placedGroup = group.map((b) => ({ ...b, staffId: moves.get(b.id)!.staffId, start: moves.get(b.id)!.start }));
      if (!blockIsClear(s, trial, move, off, placedGroup)) continue;
      const trialMoves = new Map([...moves].map(([k, v]) => [k, { ...v }]));
      if (!tryPlace(s, trial, group, trialMoves, off).length) {
        for (const [k, v] of trialMoves) moves.set(k, v);
        return move;
      }
    }
  }
  return null;
}

// A moved block doesn't land on a client or another block.
function blockIsClear(s: Search, state: State, move: BlockMove, off: Set<string>, also: readonly BookedItem[] = []): boolean {
  const ctx = calendarFor(s, state, off);
  if (busyDuring(ctx, move.staffId, move.to.start, move.to.end, also).length) return false;
  return !(ctx.blocks ?? []).some(
    (b) => blockKey(b) !== blockKey(move) && b.staffId === move.staffId && b.start < move.to.end && move.to.start < b.end,
  );
}

// The client in the way, if the only problem is one client of the same
// stylist who can be pushed along.
function bumpable(s: Search, state: State, problems: BookingProblem[], staffId: string, anchor: BookedItem, already: string[]): string | null {
  if (problems.length !== 1 || problems[0].code !== "staff_double_booked") return null;
  const id = problems[0].conflictWith;
  if (!id || already.includes(id) || s.pinned.has(id) || state.placed.has(id) || state.pending.some((p) => p.itemId === id)) return null;
  const item = s.effective.get(id);
  if (!item || item.staffId !== staffId || item.appointmentId === anchor.appointmentId) return null;
  if (!isMovable(s.day.statuses.get(item.appointmentId!))) return null;
  // Only clients after this one get pushed.
  return item.start.getTime() >= anchor.start.getTime() ? id : null;
}

function withScores(s: Search, state: State): State {
  const score = measure(s, state).score;
  return { ...state, score, estimate: score + estimate(s, state) };
}

// Each pending visit will move at least one more client.
function estimate(s: Search, state: State): number {
  const moved = new Set([...state.placed.keys()].map((id) => s.effective.get(id)!.appointmentId));
  const more = new Set(state.pending.map((p) => s.effective.get(p.itemId)!.appointmentId).filter((a) => !moved.has(a)));
  return more.size * 1000;
}

function measure(s: Search, state: State) {
  const shiftByVisit = new Map<string, number>();
  let stylistChanges = 0;
  for (const [id, to] of state.placed) {
    const from = s.real.get(id)!;
    const shift = Math.round((to.start.getTime() - from.start.getTime()) / MINUTE);
    if (shift === 0 && to.staffId === from.staffId) continue;
    shiftByVisit.set(from.appointmentId!, Math.max(shiftByVisit.get(from.appointmentId!) ?? 0, shift));
    if (to.staffId !== from.staffId) stylistChanges++;
  }
  const shiftMinutes = [...shiftByVisit.values()].reduce((sum, m) => sum + m, 0);
  const clientsMoved = shiftByVisit.size;
  const blockMinutes = [...state.blockMoves.values()].reduce((sum, m) => sum + BLOCK_MOVE_MINUTES + Math.abs(m.to.start.getTime() - m.from.start.getTime()) / MINUTE, 0);
  const score = state.unresolved.length * 100_000 + clientsMoved * 1000 + shiftMinutes + stylistChanges * STYLIST_CHANGE_MINUTES + blockMinutes + splitCost(s, state);
  return { clientsMoved, shiftMinutes, stylistChanges, score };
}

// What splitting group bookings up costs: about what moving every guest an
// hour later would, so keeping the party together wins when it fits.
function splitCost(s: Search, state: State): number {
  if (!s.day.groups?.size || !state.placed.size) return 0;
  const shifts = new Map<string, Map<string, number>>();
  // A visit's shift is its first service's.
  const inOrder = [...s.real.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const b of inOrder) {
    const groupId = s.day.groups.get(b.appointmentId!);
    if (!groupId) continue;
    const visits = shifts.get(groupId) ?? new Map<string, number>();
    if (!visits.has(b.appointmentId!)) {
      const to = state.placed.get(b.id);
      visits.set(b.appointmentId!, to ? to.start.getTime() - b.start.getTime() : 0);
    }
    shifts.set(groupId, visits);
  }
  let cost = 0;
  for (const visits of shifts.values()) if (new Set(visits.values()).size > 1) cost += (visits.size - 1) * 1000 + visits.size * GROUP_SPLIT_MINUTES;
  return cost;
}

// A finished plan as an option, if it passes the booking rules as a whole.
function finish(s: Search, state: State, alsoMoving: string[]): FixOption | null {
  const moves: ItemChange[] = [];
  for (const [id, to] of state.placed) {
    const from = s.real.get(id)!;
    if (to.start.getTime() === from.start.getTime() && to.staffId === from.staffId && to.resourceId === (from.resourceId ?? null)) continue;
    moves.push({
      itemId: id,
      appointmentId: from.appointmentId!,
      from: { staffId: from.staffId, resourceId: from.resourceId ?? null, start: from.start },
      to: { ...to },
    });
  }
  // Changing nothing isn't a fix.
  if (!moves.length) return null;
  // A late client's visit must move even if the plan left it alone.
  if (alsoMoving.some((id) => !state.placed.has(id) && !state.unresolved.includes(id))) return null;
  const withBlocks = { ...s.eff, blocks: movedBlocks(s.eff.blocks ?? [], state.blockMoves) };
  if (!checkMoves(withBlocks, moves.map((m) => ({ itemId: m.itemId, ...m.to }))).valid) return null;
  for (const m of state.blockMoves.values()) if (!blockIsClear(s, { ...state, pending: [] }, m, new Set())) return null;
  moves.sort((a, b) => a.to.start.getTime() - b.to.start.getTime());
  return { moves, blockMoves: [...state.blockMoves.values()], unresolved: [...state.unresolved], ...measure(s, state) };
}

// A small binary heap.
class Heap<T> {
  private items: T[] = [];
  private readonly less: (a: T, b: T) => number;
  constructor(less: (a: T, b: T) => number) {
    this.less = less;
  }
  get size() {
    return this.items.length;
  }
  push(item: T) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (this.less(a[i], a[parent]) >= 0) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      i = parent;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length && last !== undefined) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m]) < 0) m = l;
        if (r < a.length && this.less(a[r], a[m]) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
