// The event builder's state and what follows from it (pure, shared by the
// builder on screen and the server that saves it): the timeline (worked out
// backward from the ready-by time, or as dragged), the price and the
// payment schedule, and the input save_event takes.

import { laneKey, laneSpans, reverseTimeline, suggestLanes, timelineProblems, type Lanes, type TimelineMember, type TimelineTask } from "../scheduling/events.ts";
import { fromLocal, type LocalDate } from "../scheduling/time.ts";
import { priceEvent, type EventPrice } from "./pricing.ts";
import type { EventPackage, EventSettings, PartyMember } from "./types.ts";

export type BuilderState = {
  title: string;
  clientId: string | null;
  clientName: string;
  newClient: { firstName: string; lastName: string; phone: string; email: string } | null;
  date: LocalDate;
  readyBy: number | null;
  onLocation: boolean;
  venueName: string;
  venueAddress: string;
  travelMiles: number;
  travelMinutes: number;
  notes: string;
  billing: "main" | "split";
  members: PartyMember[];
  lanes: Lanes;
  // Who's on each lane ("hair-1" → staff id).
  team: Record<string, string | null>;
  // A timeline as dragged; null to work it out from the ready-by time.
  tasks: TimelineTask[] | null;
  source: "desk" | "denise" | "online";
  described: string;
};

export const memberKey = (index: number) => String(index + 1);

export function timelineMembers(members: readonly PartyMember[], packages: readonly EventPackage[]): TimelineMember[] {
  const byId = new Map(packages.map((p) => [p.id, p]));
  const brideAt = members.findIndex((m) => m.partyRole === "bride");
  return members.map((m, i) => {
    const p = byId.get(m.packageId);
    return { key: memberKey(i), bride: i === brideAt, hairMinutes: p?.hairMinutes ?? 0, makeupMinutes: p?.makeupMinutes ?? 0 };
  });
}

export function lanesFor(members: readonly PartyMember[], packages: readonly EventPackage[], s: EventSettings): Lanes {
  return suggestLanes(timelineMembers(members, packages), s.bufferMinutes);
}

// The timeline: as dragged, or worked out backward from the ready-by time.
export function timelineOf(state: BuilderState, packages: readonly EventPackage[], s: EventSettings): TimelineTask[] {
  if (state.tasks) return state.tasks;
  if (state.readyBy == null) return [];
  return reverseTimeline({ readyBy: state.readyBy, members: timelineMembers(state.members, packages), lanes: state.lanes, bufferMinutes: s.bufferMinutes, touchUpMinutes: s.touchUpMinutes });
}

export function earlyLanes(tasks: readonly TimelineTask[], s: Pick<EventSettings, "earlyStartMinute">): number {
  return laneSpans(tasks).filter((l) => l.first < s.earlyStartMinute).length;
}

export function priceOf(state: BuilderState, packages: readonly EventPackage[], s: EventSettings, taxBp: number, tasks: readonly TimelineTask[]): EventPrice {
  const byId = new Map(packages.map((p) => [p.id, p]));
  return priceEvent(
    {
      members: state.members.map((m) => ({ priceCents: byId.get(m.packageId)?.priceCents ?? 0, paysOwn: m.paysOwn })),
      billing: state.billing,
      onLocation: state.onLocation,
      travelMiles: state.travelMiles,
      earlyLanes: earlyLanes(tasks, s),
    },
    s,
    taxBp,
  );
}

// What stops a save (the details); team clashes are shown, not blocking,
// until the event is booked.
export function builderProblems(state: BuilderState, packages: readonly EventPackage[], s: EventSettings, today: LocalDate): string[] {
  const problems: string[] = [];
  if (!state.title.trim()) problems.push("Give the event a name.");
  if (!state.clientId && !(state.newClient?.firstName.trim() && (state.newClient.phone.trim() || state.newClient.email.trim()))) problems.push("Choose the client, or add their name and a phone number or email.");
  if (!state.date || state.date < today) problems.push("Choose a date that hasn't passed.");
  if (!state.members.length) problems.push("Add the party.");
  const ids = new Set(packages.filter((p) => !p.isTrial).map((p) => p.id));
  if (state.members.some((m) => !ids.has(m.packageId))) problems.push("Choose a package for everyone in the party.");
  if (state.members.length && state.readyBy == null) problems.push("Add the ready-by time.");
  const tasks = timelineOf(state, packages, s);
  const bride = state.members.findIndex((m) => m.partyRole === "bride");
  if (tasks.length && timelineProblems(tasks, state.readyBy ?? 0, bride >= 0 ? memberKey(bride) : null).length) problems.push("Sort out the timeline first.");
  return problems;
}

// save_event's input, with the timeline as instants.
export function saveInput(state: BuilderState, tasks: readonly TimelineTask[], timeZone: string) {
  const at = (minute: number) => fromLocal(state.date, minute, timeZone)?.toISOString() ?? null;
  return {
    title: state.title.trim(),
    client_id: state.clientId,
    new_client: state.clientId ? null : state.newClient && { first_name: state.newClient.firstName, last_name: state.newClient.lastName, phone: state.newClient.phone, email: state.newClient.email },
    event_date: state.date,
    ready_by: state.readyBy == null ? null : at(state.readyBy),
    venue_name: state.onLocation ? state.venueName : "",
    venue_address: state.onLocation ? state.venueAddress : "",
    on_location: state.onLocation,
    travel_miles: state.onLocation ? state.travelMiles : 0,
    travel_minutes: state.onLocation ? state.travelMinutes : 0,
    notes: state.notes,
    billing: state.billing,
    source: state.source,
    described: state.described,
    members: state.members.map((m) => ({ id: m.id, name: m.name, party_role: m.partyRole, package_id: m.packageId, pays_own: state.billing === "split" && m.paysOwn, email: m.email, phone: m.phone })),
    tasks: tasks.map((t) => ({ member: t.member, kind: t.kind, role: t.role, lane: t.lane, staff_id: state.team[laneKey(t)] ?? null, starts_at: at(t.start), ends_at: at(t.end) })),
  };
}
