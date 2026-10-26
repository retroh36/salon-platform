// Sick-day rescue, for the review screen (pure): the plan from
// lib/scheduling/rescue.ts as rows and choices staff can read and change,
// in our own words, the client message each change calls for, the notices
// for the stylists covering, and the check that staff's choices still fit
// together (the server checks the booking rules again on apply).

import { formatPrice } from "./services";
import { durationMinutes, itemEnd, staffBusySpans, type ServiceTiming } from "./scheduling/booking.ts";
import type { RescueLine, RescueOption } from "./scheduling/rescue.ts";
import { daysBetween, formatMinute, toLocal, type LocalDate } from "./scheduling/time.ts";

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const dayLabel = (date: LocalDate) => DAY.format(new Date(`${date}T12:00:00Z`));

type Span = { start: number; end: number };
// What a choice holds: the stylist's hands-on time and the chair.
export type Hold = { appointmentId: string; staffId: string; resourceId: string | null; staff: Span[]; resource: Span };

export type RescueMoveJson = { itemId: string; staffId: string; resourceId: string | null; start: string; timing: ServiceTiming };

export type RescueChoice = {
  kind: RescueOption["kind"] | "leave";
  // "Lois at 10am", "Wed, Oct 28 at 10am with Nola", "Leave it and call".
  label: string;
  // "Same level", "Master · $20 more", "45 minutes later", "Takes 15 minutes longer".
  detail: string | null;
  moves: RescueMoveJson[];
  holds: Hold[];
};

export type RescueRow = {
  appointmentId: string;
  clientId: string | null;
  clientName: string;
  firstName: string | null;
  // "Women's Cut & Style, Gloss" and "10am–11:30am".
  services: string;
  when: string;
  note: string | null;
  // Holds of the visit's other stylists where they are now (for "leave").
  stays: Hold[];
  choices: RescueChoice[];
  // The choice it starts on; the last is always "leave".
  choice: number;
};

export type RescueFacts = {
  tz: string;
  date: LocalDate;
  absentName: string;
  names: ReadonlyMap<string, string>;
  levels: ReadonlyMap<string, string | null>;
  // A stylist's price for a service, to say what changes.
  priceOf: (staffId: string, serviceId: string) => number | null;
  services: ReadonlyMap<string, string>;
};

const LEVEL_NAMES: Record<string, string> = { artisan: "Artisan", senior: "Senior", master: "Master" };

function holdOf(m: { appointmentId: string; staffId: string; resourceId: string | null; start: Date; timing: ServiceTiming; serviceId: string }): Hold {
  const item = { ...m.timing, serviceId: m.serviceId, staffId: m.staffId, start: m.start };
  return { appointmentId: m.appointmentId, staffId: m.staffId, resourceId: m.resourceId, staff: staffBusySpans(item), resource: { start: m.start.getTime(), end: itemEnd(item).getTime() } };
}

const timeRange = (start: Date, end: Date, tz: string) => `${formatMinute(toLocal(start, tz).minute)}–${formatMinute(toLocal(end, tz).minute)}`;

function describe(o: RescueOption, line: RescueLine, f: RescueFacts, absentId: string): { label: string; detail: string | null } {
  const name = f.names.get(o.staffId) ?? "another stylist";
  const time = formatMinute(toLocal(o.start, f.tz).minute);
  const details: string[] = [];
  if (o.kind === "reschedule") {
    const label = `${dayLabel(o.date)} at ${time} with ${name}`;
    if (o.staffId !== absentId && o.sameLevel) details.push("Same level");
    return { label, detail: details.join(" · ") || null };
  }
  if (o.sameLevel) details.push("Same level");
  else details.push(LEVEL_NAMES[f.levels.get(o.staffId) ?? ""] ?? "Another level");
  if (o.shift) details.push(`${o.shift} minutes later`);
  // What the client pays, and how long it takes, with the new stylist.
  const out = line.visit.items.filter((i) => i.staffId === absentId);
  const before = out.reduce((sum, i) => sum + (f.priceOf(absentId, i.serviceId) ?? 0), 0);
  const after = out.reduce((sum, i) => sum + (f.priceOf(o.staffId, i.serviceId) ?? 0), 0);
  if (after !== before) details.push(`${formatPrice(Math.abs(after - before))} ${after > before ? "more" : "less"}`);
  const longer = o.moves.reduce((sum, m) => sum + durationMinutes(m.timing), 0) - line.visit.items.reduce((sum, i) => sum + durationMinutes(i), 0);
  if (longer >= 10) details.push(`takes ${longer} minutes longer`);
  const label = `${name} at ${time}`;
  return { label, detail: details.join(" · ").replace(/^./, (c) => c.toUpperCase()) };
}

const NOTES: Record<NonNullable<RescueLine["note"]>, string> = {
  in_chair: "In the chair already, so it stays.",
  only_sees: "Only sees {absent}: offered {absent}'s next openings.",
  prefers: "Usually sees {absent}: starts on a new day with them.",
  none_fit: "Nothing fits. Leave it and call to rebook.",
};

export function rescueRows(
  lines: readonly RescueLine[],
  f: RescueFacts,
  absentId: string,
  clients: ReadonlyMap<string, { name: string; firstName: string }>,
): RescueRow[] {
  return lines.map((line) => {
    const v = line.visit;
    const items = v.items;
    const client = v.clientId ? clients.get(v.clientId) : undefined;
    const end = new Date(Math.max(...items.map((i) => itemEnd(i).getTime())));
    const stays = items.filter((i) => i.staffId !== absentId).map((i) => holdOf({ ...i, appointmentId: v.appointmentId, resourceId: i.resourceId ?? null, timing: i }));
    const choices: RescueChoice[] = line.options.map((o) => ({
      kind: o.kind,
      ...describe(o, line, f, absentId),
      moves: o.moves.map((m) => ({ itemId: m.itemId, staffId: m.staffId, resourceId: m.resourceId, start: m.start.toISOString(), timing: m.timing })),
      holds: o.moves.map((m) => holdOf({ ...m, serviceId: items.find((i) => i.id === m.itemId)!.serviceId })),
    }));
    choices.push({ kind: "leave", label: line.note === "in_chair" ? "Leave it" : "Leave it and call the client", detail: null, moves: [], holds: [] });
    return {
      appointmentId: v.appointmentId,
      clientId: v.clientId,
      clientName: client?.name ?? "Walk-in",
      firstName: client?.firstName ?? null,
      services: items.map((i) => f.services.get(i.serviceId) ?? "Service").join(", "),
      when: timeRange(items[0].start, end, f.tz),
      note: line.note ? NOTES[line.note].replaceAll("{absent}", f.absentName) : null,
      stays,
      choices,
      choice: line.choice ?? choices.length - 1,
    };
  });
}

const overlap = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

// Rows whose choice clashes with an earlier row's: the same stylist's
// hands-on time, or the same chair, at once. Each row holds its choice's
// places, or (left as it is) its other stylists' places.
export function clashingRows(rows: readonly RescueRow[], choices: readonly number[]): number[] {
  const held: Hold[] = [];
  const bad: number[] = [];
  rows.forEach((row, i) => {
    const c = row.choices[choices[i]];
    const mine = c && c.kind !== "leave" ? c.holds : row.stays;
    const clash = mine.some((h) =>
      held.some(
        (o) =>
          o.appointmentId !== h.appointmentId &&
          ((o.staffId === h.staffId && o.staff.some((a) => h.staff.some((b) => overlap(a, b)))) || (h.resourceId !== null && o.resourceId === h.resourceId && overlap(o.resource, h.resource))),
      ),
    );
    if (clash) bad.push(i);
    held.push(...mine);
  });
  return bad;
}

export function movesOf(rows: readonly RescueRow[], choices: readonly number[]): (RescueMoveJson & { appointmentId: string })[] {
  return rows.flatMap((row, i) => (row.choices[choices[i]]?.moves ?? []).map((m) => ({ ...m, appointmentId: row.appointmentId })));
}

// The message a change calls for, once it's applied: a new stylist at the
// same time, a new time, or (left as it is) a call to move it.
export function messageFor(kind: RescueChoice["kind"]): "stylist_out_covered" | "stylist_out_moved" | "need_to_move" | null {
  if (kind === "cover") return "stylist_out_covered";
  if (kind === "shift" || kind === "reschedule") return "stylist_out_moved";
  return kind === "leave" ? "need_to_move" : null;
}

// The notice in the app for a stylist taking on a client, and for undo.
export function coverNotice(f: RescueFacts, m: { staffId: string; start: Date }, clientFirst: string | null, service: string, today: LocalDate) {
  const local = toLocal(m.start, f.tz);
  const day = local.date === today ? "today" : daysBetween(today, local.date) === 1 ? "tomorrow" : dayLabel(local.date);
  const who = clientFirst ?? "a walk-in";
  return {
    body: `${f.absentName} is out. You have ${who}'s ${service} ${day} at ${formatMinute(local.minute)}.`,
    undo: `${who}'s ${service} ${day} at ${formatMinute(local.minute)} is back with ${f.absentName}.`,
  };
}
