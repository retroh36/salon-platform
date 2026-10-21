// Denise's words for conflicts and fixes, from templates. She speaks in the
// first person, briefly and warmly. When Claude is connected it writes the
// explanations (./claude.ts); these are the fallback and the rest.
//
// Client names here are for staff on screen only; they're never sent to
// Claude in full.

import type { BookedItem } from "@/lib/scheduling/booking";
import type { Conflict, FixOption } from "@/lib/scheduling/resolve";
import { toLocal } from "@/lib/scheduling/time";
import type { VisitChange } from "@/lib/notifications";
import type { FixMove } from "./types";

export type Visit = { status: string; client: { id: string; firstName: string; fullName: string } | null };

// Names and details for the day being looked at.
export type Lookup = {
  timeZone: string;
  salon: string;
  items: ReadonlyMap<string, BookedItem>;
  visits: ReadonlyMap<string, Visit>;
  staff: ReadonlyMap<string, { firstName: string }>;
  services: ReadonlyMap<string, string>;
  resources: ReadonlyMap<string, string>;
};

// 660 -> "11:00", 800 -> "1:20" (the day makes am/pm clear).
export function clock(minute: number): string {
  const h = Math.floor(minute / 60) % 12 || 12;
  return `${h}:${String(minute % 60).padStart(2, "0")}`;
}

const minuteOf = (l: Lookup, d: Date) => toLocal(d, l.timeZone).minute;
const staffName = (l: Lookup, id: string) => l.staff.get(id)?.firstName ?? "another stylist";
const clientName = (l: Lookup, appointmentId: string) => l.visits.get(appointmentId)?.client?.fullName ?? "A walk-in";
const firstName = (l: Lookup, appointmentId: string) => l.visits.get(appointmentId)?.client?.firstName ?? "The walk-in";
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const itemName = (l: Lookup, id: string) => clientName(l, l.items.get(id)?.appointmentId ?? "");

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const count = (n: number) => NUMBERS[n] ?? String(n);

// `firstNames` for Claude, which only gets clients' first names.
export function headline(c: Conflict, l: Lookup, firstNames = false): string {
  const staff = c.staffId ? staffName(l, c.staffId) : null;
  switch (c.kind) {
    case "overrun":
      return `${possessive(staff!)} running ${c.minutes} minutes late.`;
    case "client_late": {
      const visit = l.items.get(c.causeItemIds[0])!.appointmentId!;
      return `${firstNames ? firstName(l, visit) : clientName(l, visit)} is running ${c.minutes} minutes late.`;
    }
    case "call_out":
      return `${staff} is out for the rest of the day.`;
    case "double_booking": {
      const [a, b] = c.causeItemIds.map((id) => l.items.get(id)!);
      const at = clock(minuteOf(l, a.start > b.start ? a.start : b.start));
      return staff ? `${staff} is double-booked at ${at}.` : `Two clients are booked into the same chair at ${at}.`;
    }
  }
}

// Who couldn't be moved, if anyone.
export function note(c: Conflict, l: Lookup): string | null {
  if (!c.stuck.length) return null;
  const names = [...new Set(c.stuck.map((id) => itemName(l, id)))];
  return `${list(names)} ${names.length > 1 ? "are" : "is"} already checked in, so I've left ${names.length > 1 ? "those visits" : "that visit"} as ${names.length > 1 ? "they are" : "it is"}.`;
}

// Each moved visit once, by its first moved service.
export function visitChanges(option: FixOption, l: Lookup): VisitChange[] {
  const byVisit = new Map<string, FixOption["moves"][number]>();
  for (const m of option.moves) {
    const first = byVisit.get(m.appointmentId);
    if (!first || m.from.start < first.from.start) byVisit.set(m.appointmentId, m);
  }
  return [...byVisit.values()].map((m) => {
    const visit = l.visits.get(m.appointmentId);
    return {
      appointmentId: m.appointmentId,
      client: visit?.client ?? null,
      salon: l.salon,
      service: l.services.get(l.items.get(m.itemId)?.serviceId ?? "") ?? "appointment",
      from: { minute: minuteOf(l, m.from.start), staffId: m.from.staffId, staffFirstName: staffName(l, m.from.staffId) },
      to: { minute: minuteOf(l, m.to.start), staffId: m.to.staffId, staffFirstName: staffName(l, m.to.staffId) },
    };
  });
}

export function moves(option: FixOption, l: Lookup): FixMove[] {
  return option.moves.map((m) => ({
    itemId: m.itemId,
    appointmentId: m.appointmentId,
    clientName: clientName(l, m.appointmentId),
    service: l.services.get(l.items.get(m.itemId)?.serviceId ?? "") ?? "",
    from: { staffId: m.from.staffId, minute: minuteOf(l, m.from.start) },
    to: { staffId: m.to.staffId, minute: minuteOf(l, m.to.start) },
  }));
}

// "Grace Lewis 11:00 → 11:20", "Ada Brown → Ethan at 2:00".
export function summary(option: FixOption, l: Lookup): string {
  const parts = visitChanges(option, l).map((v) => {
    const name = v.client?.fullName ?? "Walk-in";
    const staffChanged = v.from.staffId !== v.to.staffId;
    if (v.from.minute === v.to.minute && !staffChanged) {
      const m = option.moves.find((x) => x.appointmentId === v.appointmentId)!;
      return `${name} → ${l.resources.get(m.to.resourceId ?? "") ?? "another chair"}`;
    }
    if (v.from.minute === v.to.minute) return `${name} → ${v.to.staffFirstName} at ${clock(v.to.minute)}`;
    return `${name} ${clock(v.from.minute)} → ${clock(v.to.minute)}${staffChanged ? ` with ${v.to.staffFirstName}` : ""}`;
  });
  return parts.join("; ");
}

function unresolvedNames(option: FixOption, l: Lookup): string[] {
  return [...new Set(option.unresolved.map((id) => itemName(l, id)))];
}

// Denise presenting her best fix.
export function intro(option: FixOption, l: Lookup): string {
  const what = summary(option, l);
  const lead =
    option.clientsMoved === 0
      ? `I can sort it without moving anyone: ${what}.`
      : option.clientsMoved === 1
        ? `I found a fix that only moves one client: ${what}.`
        : `I found a fix that moves ${count(option.clientsMoved)} clients: ${what}.`;
  const left = unresolvedNames(option, l);
  const gap = left.length ? ` I couldn't find a place today for ${list(left)}, so they'll need a call to rebook.` : "";
  return `${lead}${gap} Want me to apply it?`;
}

// Why the fix works: the fallback explanation when Claude isn't connected.
export function templateReason(c: Conflict, option: FixOption, l: Lookup): string {
  const clauses = visitChanges(option, l).map((v) => {
    const who = v.client?.firstName ?? "The walk-in";
    const shift = v.to.minute - v.from.minute;
    if (v.from.staffId === v.to.staffId) {
      return shift === 0 ? `${who} keeps the same time with ${v.to.staffFirstName} in another chair.` : `${who} starts ${shift} minutes later and stays with ${v.to.staffFirstName}.`;
    }
    return shift === 0
      ? `${v.to.staffFirstName} is free at ${clock(v.to.minute)} and can take ${who} at the same time.`
      : `${v.to.staffFirstName} can take ${who} ${shift} minutes later, at ${clock(v.to.minute)}.`;
  });
  const left = unresolvedNames(option, l);
  if (left.length) clauses.push(`No one free today can take ${list(left)}.`);
  else if (option.clientsMoved <= 1 && c.kind !== "call_out") clauses.push("Nothing else on the calendar changes.");
  return clauses.join(" ");
}

// The facts about a fix, without client details, for Claude to explain.
export function factsFor(c: Conflict, option: FixOption, l: Lookup) {
  return {
    problem: headline(c, l, true),
    changes: visitChanges(option, l).map((v) => ({
      client: v.client?.firstName ?? "walk-in",
      service: v.service,
      from: `${clock(v.from.minute)} with ${v.from.staffFirstName}`,
      to: `${clock(v.to.minute)} with ${v.to.staffFirstName}`,
    })),
    clientsMoved: option.clientsMoved,
    couldNotPlace: option.unresolved.map((id) => firstName(l, l.items.get(id)?.appointmentId ?? "")),
  };
}
