// Messages to clients and stylists when an appointment changes.
//
// Client messages use these approved templates only: never AI-written text
// (the AI doesn't talk to clients). Nothing is sent yet; the notifications
// table records what would be (texts come in a later phase).

import type { NotificationDraft } from "@/lib/scheduling/ai-actions";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, type LocalDate } from "@/lib/scheduling/time";

// One visit's change, from the client's point of view: their first
// service's old and new time and stylist.
export type VisitChange = {
  appointmentId: string;
  client: { id: string; firstName: string; fullName: string } | null;
  salon: string;
  service: string;
  from: { minute: number; staffId: string; staffFirstName: string };
  to: { minute: number; staffId: string; staffFirstName: string };
};

function clientMessage(c: VisitChange, undo: boolean): string {
  const hi = `Hi ${c.client!.firstName}, it's ${c.salon}.`;
  if (undo) {
    return `${hi} Sorry for the mix-up: your appointment today is back at ${formatMinute(c.from.minute)} with ${c.from.staffFirstName}. See you then!`;
  }
  const sameStylist = c.from.staffId === c.to.staffId;
  const when = c.from.minute === c.to.minute ? `is still at ${formatMinute(c.to.minute)}` : `has moved from ${formatMinute(c.from.minute)} to ${formatMinute(c.to.minute)}`;
  const who = sameStylist ? `, still with ${c.to.staffFirstName}` : ` and will be with ${c.to.staffFirstName}`;
  return `${hi} Your appointment today ${when}${who}. Reply or call us if that doesn't work. See you soon!`;
}

function staffMessage(c: VisitChange, staffId: string, undo: boolean): string {
  const name = c.client?.fullName ?? "A walk-in";
  const [from, to] = undo ? [c.to, c.from] : [c.from, c.to];
  if (from.staffId === to.staffId) return `${name}'s ${c.service} has moved from ${formatMinute(from.minute)} to ${formatMinute(to.minute)}.`;
  if (staffId === to.staffId) return `${name}'s ${c.service} at ${formatMinute(to.minute)} is now with you (it was with ${from.staffFirstName}).`;
  return `${name}'s ${c.service} at ${formatMinute(from.minute)} has moved to ${to.staffFirstName} at ${formatMinute(to.minute)}.`;
}

// What to send when a change is applied, and what to send instead if it's
// undone after these went out: the client, and each stylist involved.
export function notificationsFor(changes: readonly VisitChange[]): { notifications: NotificationDraft[]; undo: NotificationDraft[] } {
  const notifications: NotificationDraft[] = [];
  const undo: NotificationDraft[] = [];
  for (const c of changes) {
    // A new chair at the same time with the same stylist needs no notice.
    if (c.from.minute === c.to.minute && c.from.staffId === c.to.staffId) continue;
    if (c.client) {
      notifications.push({ template: "time_change", body: clientMessage(c, false), appointmentId: c.appointmentId, clientId: c.client.id });
      undo.push({ template: "time_change_undone", body: clientMessage(c, true), appointmentId: c.appointmentId, clientId: c.client.id });
    }
    for (const staffId of new Set([c.from.staffId, c.to.staffId])) {
      notifications.push({ template: "staff_schedule_change", body: staffMessage(c, staffId, false), appointmentId: c.appointmentId, staffId });
      undo.push({ template: "staff_schedule_change_undone", body: staffMessage(c, staffId, true), appointmentId: c.appointmentId, staffId });
    }
  }
  return { notifications, undo };
}

// A lunch or break Denise moved: tell the stylist (and, on undo, that it's
// back).
export function blockNotifications(
  moves: readonly { staffId: string; kind: string; from: number; to: number }[],
): { notifications: NotificationDraft[]; undo: NotificationDraft[] } {
  const notifications: NotificationDraft[] = [];
  const undo: NotificationDraft[] = [];
  for (const m of moves) {
    notifications.push({ template: "staff_block_moved", body: `Your ${m.kind} today has moved from ${formatMinute(m.from)} to ${formatMinute(m.to)}.`, appointmentId: null, staffId: m.staffId });
    undo.push({ template: "staff_block_moved_undone", body: `Your ${m.kind} today is back at ${formatMinute(m.from)}.`, appointmentId: null, staffId: m.staffId });
  }
  return { notifications, undo };
}

// A visit staff moved (edited, dragged, or moved to another day): its
// first service's day, time and stylist before and after.
export type VisitMove = {
  appointmentId: string;
  client: { id: string; firstName: string; fullName: string } | null;
  salon: string;
  service: string;
  // The salon's today, to say "today" rather than the date.
  today: LocalDate;
  from: { date: LocalDate; minute: number; staffId: string; staffFirstName: string };
  to: { date: LocalDate; minute: number; staffId: string; staffFirstName: string };
};

export type MoveNotice = { template: "visit_moved"; body: string; clientId: string } | { template: "staff_visit_moved"; body: string; staffId: string };

const dayText = (date: LocalDate, today: LocalDate) => (date === today ? "today" : `on ${formatDay(date)}`);
// "on Tue, Oct 27 at 2pm" (or "today at 2pm"), and without the "on" after
// "from" and "to".
const at = (p: { date: LocalDate; minute: number }, today: LocalDate) => `${dayText(p.date, today)} at ${formatMinute(p.minute)}`;
const bare = (p: { date: LocalDate; minute: number }, today: LocalDate) => `${p.date === today ? "today" : formatDay(p.date)} at ${formatMinute(p.minute)}`;

// The client and each stylist involved, in fixed templates. Nothing when
// the day, time and stylist are all the same (a new chair, say).
export function moveNotices(m: VisitMove): MoveNotice[] {
  const sameDay = m.from.date === m.to.date;
  const sameTime = sameDay && m.from.minute === m.to.minute;
  const sameStylist = m.from.staffId === m.to.staffId;
  if (sameTime && sameStylist) return [];
  const out: MoveNotice[] = [];
  if (m.client) {
    const hi = `Hi ${m.client.firstName}, it's ${m.salon}.`;
    const when = sameTime
      ? `${dayText(m.to.date, m.today)} at ${formatMinute(m.to.minute)} is still on`
      : sameDay
        ? `${dayText(m.to.date, m.today)} has moved from ${formatMinute(m.from.minute)} to ${formatMinute(m.to.minute)}`
        : `has moved from ${bare(m.from, m.today)} to ${bare(m.to, m.today)}`;
    const who = sameStylist ? `, still with ${m.to.staffFirstName}` : ` and will be with ${m.to.staffFirstName}`;
    out.push({ template: "visit_moved", body: `${hi} Your appointment ${when}${who}. Reply or call us if that doesn't work. See you soon!`, clientId: m.client.id });
  }
  const name = m.client?.fullName ?? "A walk-in";
  for (const staffId of new Set([m.from.staffId, m.to.staffId])) {
    const body = sameStylist
      ? `${name}'s ${m.service} has moved from ${bare(m.from, m.today)} to ${bare(m.to, m.today)}.`
      : staffId === m.to.staffId
        ? `${name}'s ${m.service} ${at(m.to, m.today)} is now with you (it was with ${m.from.staffFirstName}).`
        : `${name}'s ${m.service} ${at(m.from, m.today)} has moved to ${m.to.staffFirstName}, ${bare(m.to, m.today)}.`;
    out.push({ template: "staff_visit_moved", body, staffId });
  }
  return out;
}
