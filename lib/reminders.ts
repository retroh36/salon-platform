// Appointment reminders: when one is due for a visit, and its fixed
// wording (never AI-written). Pure; the sender is ./reminders-run.ts.

import { formatDay } from "@/lib/schedule-format";
import { addDays, formatMinute, type LocalDate } from "@/lib/scheduling/time";

// How long before the visit the reminder goes (Settings → Messages).
export const REMINDER_HOURS = [2, 4, 12, 24, 48, 72] as const;
export type ReminderHours = (typeof REMINDER_HOURS)[number];
export const DEFAULT_REMINDER_HOURS: ReminderHours = 24;
export const isReminderHours = (n: unknown): n is ReminderHours => REMINDER_HOURS.includes(n as ReminderHours);

// Too close to the visit to be worth sending.
export const LAST_CALL_MINUTES = 60;
// Booked this recently: they've only just made it.
export const JUST_BOOKED_MINUTES = 60;

export type ReminderVisit = { status: string; startsAt: Date; createdAt: Date };

// Due from `hours` before the visit until LAST_CALL_MINUTES before it, for
// a visit still booked or confirmed that wasn't made in the last hour. The
// sender records each one, so it goes once for each start time.
export function reminderDue(v: ReminderVisit, hours: number, now: Date): boolean {
  if (v.status !== "booked" && v.status !== "confirmed") return false;
  const ahead = (v.startsAt.getTime() - now.getTime()) / 60_000;
  if (ahead < LAST_CALL_MINUTES || ahead > hours * 60) return false;
  return (now.getTime() - v.createdAt.getTime()) / 60_000 >= JUST_BOOKED_MINUTES;
}

// "today at 2:15pm", "tomorrow, Tue, Nov 10 at 2:15pm", "Thu, Nov 12 at 9am".
export function reminderWhen(date: LocalDate, minute: number, today: LocalDate): string {
  const time = formatMinute(minute);
  if (date === today) return `today at ${time}`;
  if (date === addDays(today, 1)) return `tomorrow, ${formatDay(date)} at ${time}`;
  return `${formatDay(date)} at ${time}`;
}

// "Bridget", "Bridget and Shae".
export const stylistsText = (names: readonly string[]) => {
  const unique = [...new Set(names.filter(Boolean))];
  return unique.length > 1 ? `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}` : (unique[0] ?? "");
};

export function reminderMessage(o: { salon: string; firstName: string; when: string; stylists: string; manageUrl: string | null; phone: string | null }): { subject: string; body: string } {
  const who = o.stylists ? ` with ${o.stylists}` : "";
  const change = o.manageUrl ? ` View, change or cancel: ${o.manageUrl}` : o.phone ? ` To change it, call ${o.phone}.` : "";
  const hi = o.firstName ? `Hi ${o.firstName}, a` : "A";
  return { subject: `Your visit at ${o.salon}`, body: `${o.salon}: ${hi} reminder of your visit ${o.when}${who}.${change}` };
}
