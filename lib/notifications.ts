// Messages to clients and stylists when an appointment changes.
//
// Client messages use these approved templates only: never AI-written text
// (the AI doesn't talk to clients). Nothing is sent yet; the notifications
// table records what would be (texts come in a later phase).

import type { NotificationDraft } from "@/lib/scheduling/ai-actions";
import { formatDay } from "@/lib/schedule-format";
import { formatDuration } from "@/lib/duration";
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

function staffMessage(c: VisitChange, staffId: string, undo: boolean): string {
  const name = c.client?.fullName ?? "A walk-in";
  const [from, to] = undo ? [c.to, c.from] : [c.from, c.to];
  if (from.staffId === to.staffId) return `${name}'s ${c.service} has moved from ${formatMinute(from.minute)} to ${formatMinute(to.minute)}.`;
  if (staffId === to.staffId) return `${name}'s ${c.service} at ${formatMinute(to.minute)} is now with you (it was with ${from.staffFirstName}).`;
  return `${name}'s ${c.service} at ${formatMinute(from.minute)} has moved to ${to.staffFirstName} at ${formatMinute(to.minute)}.`;
}

// The stylist's heads-up when their visit is likely to run into the next
// client (Denise's risk check), in the app on My day, before the front desk
// sees a fix. Our wording, never Claude's.
export function headsUpText(h: { service: string; client: string; start: number; next: string; nextStart: number; minutes: number; estimated: boolean; deskMinutes: number }): string {
  const basis = h.estimated ? " (based on check-in to checkout times)" : "";
  return `Heads up: you usually take about ${formatDuration(h.minutes)} longer than booked for ${h.service}${basis}, so ${h.client}'s ${formatMinute(h.start)} may run into ${h.next}'s ${formatMinute(h.nextStart)}. The front desk will see Denise's fix in ${h.deskMinutes} minutes. Already behind? Use "I'm running late" on your column.`;
}

// What to tell each stylist involved when one of Denise's fixes is applied,
// and what to tell them instead if it's undone after these went out. Never
// the client: a client hears about a fix only from the message staff check
// and send after Apply (app/calendar/moved-messages.tsx), and the database
// refuses a fix's notice to a client (private.check_proposal_notices).
export function notificationsFor(changes: readonly VisitChange[]): { notifications: NotificationDraft[]; undo: NotificationDraft[] } {
  const notifications: NotificationDraft[] = [];
  const undo: NotificationDraft[] = [];
  for (const c of changes) {
    // A new chair at the same time with the same stylist needs no notice.
    if (c.from.minute === c.to.minute && c.from.staffId === c.to.staffId) continue;
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
  service: string;
  // The salon's today, to say "today" rather than the date.
  today: LocalDate;
  from: { date: LocalDate; minute: number; staffId: string; staffFirstName: string };
  to: { date: LocalDate; minute: number; staffId: string; staffFirstName: string };
};

export type MoveNotice = { template: "staff_visit_moved"; body: string; staffId: string };

const dayText = (date: LocalDate, today: LocalDate) => (date === today ? "today" : `on ${formatDay(date)}`);
// "on Tue, Oct 27 at 2pm" (or "today at 2pm"), and without the "on" after
// "from" and "to".
const at = (p: { date: LocalDate; minute: number }, today: LocalDate) => `${dayText(p.date, today)} at ${formatMinute(p.minute)}`;
const bare = (p: { date: LocalDate; minute: number }, today: LocalDate) => `${p.date === today ? "today" : formatDay(p.date)} at ${formatMinute(p.minute)}`;

// Each stylist involved, in fixed templates. Nothing when the day, time and
// stylist are all the same (a new chair, say). Never the client: staff
// choose to tell them, with the message they see (app/calendar/move-prompt.tsx).
export function moveNotices(m: VisitMove): MoveNotice[] {
  const sameDay = m.from.date === m.to.date;
  const sameTime = sameDay && m.from.minute === m.to.minute;
  const sameStylist = m.from.staffId === m.to.staffId;
  if (sameTime && sameStylist) return [];
  const out: MoveNotice[] = [];
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
