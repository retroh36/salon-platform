// Bridal and event timelines (pure). The day is planned backward from the
// ready-by time: everyone's last touch-up ends then, the bride finishes
// last, and each artist lane (hair 1, hair 2, makeup 1…) works one person
// at a time with a buffer between. A person is in one chair at a time,
// with makeup after hair. Then each lane gets a call time, and the people
// on it are checked against the calendar with the same rules as bookings:
// time off, their booked clients (processing time is free), blocked time
// and other events (an event holds its team's time as blocked time of kind
// "event", so bookings can't land on it either: booking.ts).
//
// Minutes here are wall-clock minutes on the event's date (converted with
// time.ts at the edges).

import { staffBusySpans, type BookingContext } from "./booking.ts";
import { overlapsSpan, type Interval } from "./intervals.ts";
import { fromLocal, type LocalDate } from "./time.ts";

export type EventRole = "hair" | "makeup";
export const EVENT_ROLES: EventRole[] = ["hair", "makeup"];

export type TimelineMember = {
  // The member's place in the party list ("1", "2"…).
  key: string;
  bride: boolean;
  hairMinutes: number;
  makeupMinutes: number;
};

export type TimelineTask = {
  // null for a touch-up.
  member: string | null;
  kind: EventRole | "touch_up";
  role: EventRole;
  lane: number;
  start: number;
  end: number;
};

export type Lanes = Record<EventRole, number>;

export type TimelineInput = {
  readyBy: number;
  members: readonly TimelineMember[];
  lanes: Lanes;
  bufferMinutes: number;
  touchUpMinutes: number;
};

export type Lane = { role: EventRole; lane: number };
export const laneKey = (l: Lane) => `${l.role}-${l.lane}`;

// Arriving to set up before the first person.
export const SETUP_MINUTES = 15;
// How long one artist lane is planned to work, at most, when suggesting
// how many artists a party needs.
export const LANE_WINDOW_MINUTES = 240;

// Artists suggested for a party: enough lanes that each works about four
// hours at most, never more lanes than people needing that service.
export function suggestLanes(members: readonly TimelineMember[], bufferMinutes: number): Lanes {
  const lanes = { hair: 0, makeup: 0 };
  for (const role of EVENT_ROLES) {
    const minutes = members.map((m) => (role === "hair" ? m.hairMinutes : m.makeupMinutes)).filter((n) => n > 0);
    if (!minutes.length) continue;
    const total = minutes.reduce((a, n) => a + n + bufferMinutes, 0);
    lanes[role] = Math.min(minutes.length, Math.max(1, Math.ceil(total / LANE_WINDOW_MINUTES)));
  }
  return lanes;
}

type Pending = { member: TimelineMember; role: EventRole; minutes: number; order: number };

// The timeline, backward from the ready-by time. The bride's services are
// placed first (so she's last in the chair), then, one at a time, the
// service that can finish latest (a person's makeup before their hair,
// since makeup comes after hair on the day), ties going to whoever is
// earlier in the party list.
export function reverseTimeline(input: TimelineInput): TimelineTask[] {
  const end = input.readyBy - input.touchUpMinutes;
  const tasks: TimelineTask[] = [];
  const cursor = new Map<string, number>();
  for (const role of EVENT_ROLES) for (let lane = 1; lane <= input.lanes[role]; lane++) cursor.set(laneKey({ role, lane }), end);
  // Everyone else finishes before the bride.
  const gap = Math.max(input.bufferMinutes, 5);
  const memberCursor = new Map(input.members.map((m) => [m.key, m.bride ? end : end - gap]));

  const pending: Pending[] = input.members.flatMap((m, order) => [
    ...(m.makeupMinutes > 0 && input.lanes.makeup > 0 ? [{ member: m, role: "makeup" as const, minutes: m.makeupMinutes, order }] : []),
    ...(m.hairMinutes > 0 && input.lanes.hair > 0 ? [{ member: m, role: "hair" as const, minutes: m.hairMinutes, order }] : []),
  ]);

  const bestLane = (role: EventRole) => {
    let best: { lane: number; at: number } | null = null;
    for (let lane = 1; lane <= input.lanes[role]; lane++) {
      const at = cursor.get(laneKey({ role, lane }))!;
      if (!best || at > best.at) best = { lane, at };
    }
    return best!;
  };
  // A person's hair waits until their makeup is placed.
  const ready = (p: Pending) => p.role === "makeup" || !pending.some((q) => q.member === p.member && q.role === "makeup");
  const latestEnd = (p: Pending) => Math.min(bestLane(p.role).at, memberCursor.get(p.member.key)!);

  while (pending.length) {
    const candidates = pending.filter(ready);
    const brides = candidates.filter((p) => p.member.bride);
    const pool = brides.length ? brides : candidates;
    pool.sort((a, b) => latestEnd(b) - latestEnd(a) || a.order - b.order || b.minutes - a.minutes);
    const next = pool[0];
    const lane = bestLane(next.role);
    const finish = Math.min(lane.at, memberCursor.get(next.member.key)!);
    const start = finish - next.minutes;
    tasks.push({ member: next.member.key, kind: next.role, role: next.role, lane: lane.lane, start, end: finish });
    cursor.set(laneKey({ role: next.role, lane: lane.lane }), start - input.bufferMinutes);
    memberCursor.set(next.member.key, start);
    pending.splice(pending.indexOf(next), 1);
  }

  if (input.touchUpMinutes > 0) {
    for (const role of EVENT_ROLES) {
      for (let lane = 1; lane <= input.lanes[role]; lane++) {
        if (tasks.some((t) => t.role === role && t.lane === lane)) tasks.push({ member: null, kind: "touch_up", role, lane, start: end, end: input.readyBy });
      }
    }
  }
  return tasks.sort((a, b) => a.start - b.start || a.role.localeCompare(b.role) || a.lane - b.lane);
}

// The lanes a timeline uses, each with its call time (setting up before
// its first person) and when it's done.
export type LaneSpan = Lane & { call: number; first: number; end: number };

export function laneSpans(tasks: readonly Pick<TimelineTask, "role" | "lane" | "start" | "end">[]): LaneSpan[] {
  const map = new Map<string, LaneSpan>();
  for (const t of tasks) {
    const key = laneKey(t);
    const span = map.get(key);
    if (!span) map.set(key, { role: t.role, lane: t.lane, first: t.start, call: t.start - SETUP_MINUTES, end: t.end });
    else {
      span.first = Math.min(span.first, t.start);
      span.call = span.first - SETUP_MINUTES;
      span.end = Math.max(span.end, t.end);
    }
  }
  return [...map.values()].sort((a, b) => a.role.localeCompare(b.role) || a.lane - b.lane);
}

// When everyone's done: the start of the day is the earliest call time.
export function timelineBounds(tasks: readonly TimelineTask[]): Interval | null {
  const spans = laneSpans(tasks);
  if (!spans.length) return null;
  return { start: Math.min(...spans.map((s) => s.call)), end: Math.max(...spans.map((s) => s.end)) };
}

// What's wrong with a timeline on its own (after dragging): a lane with
// two people at once, a person in two chairs, anything after the ready-by
// time or before midnight, makeup before hair.
export type TimelineProblem =
  | { code: "lane_overlap"; lane: Lane }
  | { code: "member_overlap"; member: string }
  | { code: "after_ready_by"; member: string | null }
  | { code: "too_early" }
  | { code: "makeup_before_hair"; member: string }
  | { code: "bride_not_last" };

export function timelineProblems(tasks: readonly TimelineTask[], readyBy: number, brideKey: string | null): TimelineProblem[] {
  const problems: TimelineProblem[] = [];
  const byLane = new Map<string, TimelineTask[]>();
  for (const t of tasks) byLane.set(laneKey(t), [...(byLane.get(laneKey(t)) ?? []), t]);
  for (const list of byLane.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    if (sorted.some((t, i) => i > 0 && t.start < sorted[i - 1].end)) problems.push({ code: "lane_overlap", lane: { role: sorted[0].role, lane: sorted[0].lane } });
  }
  const people = new Map<string, TimelineTask[]>();
  for (const t of tasks) if (t.member) people.set(t.member, [...(people.get(t.member) ?? []), t]);
  for (const [member, list] of people) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    if (sorted.some((t, i) => i > 0 && t.start < sorted[i - 1].end)) problems.push({ code: "member_overlap", member });
    const hair = list.find((t) => t.kind === "hair");
    const makeup = list.find((t) => t.kind === "makeup");
    if (hair && makeup && makeup.start < hair.end) problems.push({ code: "makeup_before_hair", member });
  }
  for (const t of tasks) if (t.end > readyBy) problems.push({ code: "after_ready_by", member: t.member });
  if (tasks.some((t) => t.start - SETUP_MINUTES < 0)) problems.push({ code: "too_early" });
  if (brideKey) {
    const brideEnd = Math.max(...tasks.filter((t) => t.member === brideKey).map((t) => t.end));
    if (tasks.some((t) => t.member && t.member !== brideKey && t.end > brideEnd)) problems.push({ code: "bride_not_last" });
  }
  return problems;
}

export function describeTimelineProblem(p: TimelineProblem, names: (key: string) => string): string {
  switch (p.code) {
    case "lane_overlap":
      return `${p.lane.role === "hair" ? "Hair" : "Makeup"} artist ${p.lane.lane} has two people at once.`;
    case "member_overlap":
      return `${names(p.member)} is in two chairs at once.`;
    case "after_ready_by":
      return p.member ? `${names(p.member)} isn't ready by the ready-by time.` : "A touch-up runs past the ready-by time.";
    case "too_early":
      return "The day would start before midnight. Choose a later ready-by time or more artists.";
    case "makeup_before_hair":
      return `${names(p.member)}'s makeup starts before their hair is done.`;
    case "bride_not_last":
      return "Someone finishes after the bride.";
  }
}

// How much of a team member's day an event holds: from travel before their
// call time to travel after their lane is done.
export function heldSpan(span: LaneSpan, travelMinutes: number): Interval {
  return { start: Math.max(0, span.call - travelMinutes), end: Math.min(24 * 60, span.end + travelMinutes) };
}

// Why someone can't take a lane, from the calendar.
export type StaffClash = "time_off" | "booked" | "blocked" | "other_event" | "not_found" | "no_role";

// Whether a team member is free for a held span on the event's date: no
// approved time off, no booked client needing them (processing is free),
// no blocked time and no other event (blocked time of kind "event"; this
// event's own blocks are left out with `eventBlockIds`).
export function staffClash(
  ctx: BookingContext,
  staff: { id: string; eventRoles: readonly string[] },
  role: EventRole,
  date: LocalDate,
  held: Interval,
  eventBlockIds: ReadonlySet<string> = new Set(),
): StaffClash | null {
  const member = ctx.staff.get(staff.id);
  if (!member || !member.isActive) return "not_found";
  if (!staff.eventRoles.includes(role)) return "no_role";
  const off = member.schedule.timeOff
    .filter((t) => t.status === "approved" && t.startsOn <= date && t.endsOn >= date)
    .map((t) => (t.startMinute != null && t.endMinute != null ? { start: t.startMinute, end: t.endMinute } : { start: 0, end: 24 * 60 }));
  if (overlapsSpan(off, held.start, held.end)) return "time_off";
  const tz = ctx.location.timeZone;
  const from = fromLocal(date, held.start, tz);
  const to = fromLocal(date, held.end, tz);
  if (!from || !to) return "not_found";
  const span = { start: from.getTime(), end: to.getTime() };
  const touches = (s: { start: number; end: number }) => s.start < span.end && span.start < s.end;
  if (ctx.booked.some((b) => b.staffId === staff.id && staffBusySpans(b).some(touches))) return "booked";
  const blocks = (ctx.blocks ?? []).filter((b) => b.staffId === staff.id && !eventBlockIds.has(b.blockId) && touches({ start: b.start.getTime(), end: b.end.getTime() }));
  if (blocks.some((b) => (b.kind as string) === "event")) return "other_event";
  if (blocks.length) return "blocked";
  return null;
}

export const CLASH_TEXT: Record<StaffClash, string> = {
  time_off: "has time off",
  booked: "has clients booked",
  blocked: "has blocked time",
  other_event: "is at another event",
  not_found: "isn't on the team",
  no_role: "doesn't do this work",
};

// The team suggested for the lanes: the work fewest people do first, and
// for each lane the first free person who does that work and isn't on
// another lane, those who do only that work before those who do both (so
// someone who does hair and makeup is kept for whichever is short).
// Candidates otherwise in the order given (the calendar's).
export function suggestTeam(
  spans: readonly LaneSpan[],
  candidates: readonly { id: string; eventRoles: readonly string[] }[],
  isFree: (staffId: string, span: LaneSpan) => boolean,
): Map<string, string | null> {
  const doing = (role: EventRole) => candidates.filter((c) => c.eventRoles.includes(role)).length;
  const order = [...spans].sort((a, b) => doing(a.role) - doing(b.role) || a.role.localeCompare(b.role) || a.lane - b.lane);
  const people = [...candidates].sort((a, b) => a.eventRoles.length - b.eventRoles.length);
  const used = new Set<string>();
  const team = new Map<string, string | null>();
  for (const span of order) {
    const pick = people.find((c) => c.eventRoles.includes(span.role) && !used.has(c.id) && isFree(c.id, span));
    if (pick) used.add(pick.id);
    team.set(laneKey(span), pick?.id ?? null);
  }
  return new Map(spans.map((s) => [laneKey(s), team.get(laneKey(s)) ?? null]));
}
