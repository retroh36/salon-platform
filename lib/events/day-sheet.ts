// The day-of sheet (pure): what the team needs on the day, from the event
// as saved. Each artist's leave time (on location: their call time less
// travel), call time and when they're done, the people they do, the
// running order, the party and the look.

import { laneSpans, SETUP_MINUTES, type EventRole } from "../scheduling/events.ts";
import { formatMinute } from "../scheduling/time.ts";
import type { EventDetail } from "./load.ts";
import { PARTY_ROLE_LABELS } from "./types.ts";

const KIND = { hair: "Hair", makeup: "Makeup", touch_up: "Touch-ups" } as const;

export type SheetArtist = {
  name: string;
  roles: EventRole[];
  // On location: when to leave the salon. Null in the salon.
  leave: string | null;
  call: string;
  done: string;
  people: string[];
};

export type SheetRow = { time: string; who: string; what: string; artist: string };

export type DaySheet = {
  title: string;
  where: string;
  readyBy: string | null;
  artists: SheetArtist[];
  unassigned: number;
  order: SheetRow[];
  party: { name: string; role: string; packageName: string }[];
  look: string | null;
  notes: string | null;
};

export function daySheet(event: Pick<EventDetail, "title" | "onLocation" | "venueName" | "venueAddress" | "travelMinutes" | "readyBy" | "members" | "tasks" | "lookNotes" | "notes">, staffName: (id: string) => string | null): DaySheet {
  const memberName = new Map(event.members.map((m) => [m.id, m.name]));
  const artistOf = (t: { role: EventRole; lane: number; staffId: string | null }) => (t.staffId ? staffName(t.staffId) : null) ?? `${KIND[t.role]} ${t.lane}`;
  const travel = event.onLocation ? event.travelMinutes : 0;

  // Each person on the team (or open lane), everything they do as one day.
  const byArtist = new Map<string, typeof event.tasks>();
  for (const t of event.tasks) {
    const key = t.staffId ?? `${t.role}-${t.lane}`;
    byArtist.set(key, [...(byArtist.get(key) ?? []), t]);
  }
  const artists = [...byArtist.values()].map((tasks) => {
    const first = Math.min(...tasks.map((t) => t.start));
    const call = first - SETUP_MINUTES;
    const done = Math.max(...tasks.map((t) => t.end));
    const roles = [...new Set(tasks.map((t) => t.role))].sort();
    return {
      name: artistOf(tasks[0]),
      roles,
      leave: travel ? formatMinute(Math.max(0, call - travel)) : null,
      call: formatMinute(call),
      done: formatMinute(done),
      people: [...new Set(tasks.filter((t) => t.memberId).map((t) => memberName.get(t.memberId!) ?? "Guest"))],
      callMinute: call,
    };
  });
  artists.sort((a, b) => a.callMinute - b.callMinute || a.name.localeCompare(b.name));

  const order: SheetRow[] = event.tasks
    .filter((t) => t.kind !== "touch_up")
    .map((t) => ({ time: `${formatMinute(t.start)}–${formatMinute(t.end)}`, who: memberName.get(t.memberId!) ?? "Guest", what: KIND[t.kind], artist: artistOf(t), at: t.start, role: t.role }))
    .sort((a, b) => a.at - b.at || a.role.localeCompare(b.role))
    .map(({ time, who, what, artist }) => ({ time, who, what, artist }));
  const touchUp = event.tasks.find((t) => t.kind === "touch_up");
  if (touchUp) order.push({ time: `${formatMinute(touchUp.start)}–${formatMinute(touchUp.end)}`, who: "Everyone", what: "Touch-ups", artist: "Whole team" });

  return {
    title: event.title,
    where: event.onLocation ? [event.venueName, event.venueAddress].filter(Boolean).join(", ") || "On location" : "In the salon",
    readyBy: event.readyBy == null ? null : formatMinute(event.readyBy),
    artists: artists.map((a) => ({ name: a.name, roles: a.roles, leave: a.leave, call: a.call, done: a.done, people: a.people })),
    unassigned: laneSpans(event.tasks).filter((s) => !event.tasks.some((t) => t.role === s.role && t.lane === s.lane && t.staffId)).length,
    order,
    party: event.members.map((m) => ({ name: m.name, role: PARTY_ROLE_LABELS[m.partyRole], packageName: m.packageName })),
    look: event.lookNotes,
    notes: event.notes,
  };
}
