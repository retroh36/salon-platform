// Clocking in and out: what each person worked against what they were
// scheduled, by day and week, and what needs a manager (a clock-out
// missed, a scheduled day with no punch). Pure; the data comes from
// lib/time-clock-load.ts. A punch counts on the day it was clocked in.

import { toLocal, type LocalDate } from "./scheduling/time.ts";

// missedOut: left open over 18 hours and clocked in again after, so it no
// longer counts as clocked in (and its length is unknown until fixed).
export type ClockEntry = { id: string; staffId: string; clockIn: Date; clockOut: Date | null; edited: boolean; missedOut?: boolean };

// Clocked in now: open, and not a missed clock-out.
export const isOpen = (e: Pick<ClockEntry, "clockOut" | "missedOut">) => e.clockOut === null && !e.missedOut;

// Minutes worked by an entry (to now while it's open).
export const entryMinutes = (e: Pick<ClockEntry, "clockIn" | "clockOut" | "missedOut">, now: Date) =>
  e.missedOut && !e.clockOut ? 0 : Math.max(0, Math.round(((e.clockOut ?? now).getTime() - e.clockIn.getTime()) / 60000));

export const entryDay = (e: Pick<ClockEntry, "clockIn">, timeZone: string) => toLocal(e.clockIn, timeZone).date;

// Where someone stands now, for My day.
export type ClockStatus = { clockedIn: boolean; since: Date | null; todayMinutes: number };

export function clockStatus(entries: readonly ClockEntry[], timeZone: string, now: Date): ClockStatus {
  const today = toLocal(now, timeZone).date;
  const open = entries.find(isOpen) ?? null;
  const todayMinutes = entries.filter((e) => entryDay(e, timeZone) === today).reduce((n, e) => n + entryMinutes(e, now), 0);
  return { clockedIn: open !== null, since: open?.clockIn ?? null, todayMinutes };
}

export type DayHours = {
  date: LocalDate;
  scheduled: number;
  worked: number;
  entries: ClockEntry[];
  // Still clocked in from an earlier day: a clock-out was missed.
  missedOut: boolean;
  // A past day they were scheduled for, with no punch at all.
  noPunch: boolean;
};

// Each day's scheduled minutes against what they clocked, for one person.
export function clockDays(staffId: string, scheduled: readonly { date: LocalDate; minutes: number }[], entries: readonly ClockEntry[], timeZone: string, now: Date): DayHours[] {
  const today = toLocal(now, timeZone).date;
  const mine = entries.filter((e) => e.staffId === staffId).sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
  return scheduled.map(({ date, minutes }) => {
    const on = mine.filter((e) => entryDay(e, timeZone) === date);
    return {
      date,
      scheduled: minutes,
      worked: on.reduce((n, e) => n + entryMinutes(e, now), 0),
      entries: on,
      missedOut: date < today && on.some((e) => e.clockOut === null),
      noPunch: date < today && minutes > 0 && on.length === 0,
    };
  });
}

// "+1 hr 15 min", "−30 min", "On schedule" (within 5 minutes).
export function differenceText(worked: number, scheduled: number): string {
  const diff = worked - scheduled;
  if (Math.abs(diff) <= 5) return "On schedule";
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const text = h && m ? `${h} hr ${m} min` : h ? `${h} hr` : `${m} min`;
  return `${diff > 0 ? "+" : "−"}${text}`;
}

// How long after a shift starts (or ends) before a reminder, and how long
// after it ends a forgotten clock-out still gets one.
export const REMIND_AFTER_MINUTES = 10;
export const OUT_REMINDER_HOURS = 3;

export type Reminder = { staffId: string; kind: "in" | "out"; shiftStart: number; shiftEnd: number };

// Who to remind now, from today's working shifts (scheduled hours less
// approved time off, in minutes from midnight) and today's punches: "in"
// once a shift is REMIND_AFTER_MINUTES old with no clock-in for it (from an
// hour before it), "out" once a shift is that long over and they're still
// clocked in from before it ended, with no later shift under way.
export function clockReminders(
  people: readonly { staffId: string; shifts: readonly { start: number; end: number }[] }[],
  entries: readonly ClockEntry[],
  timeZone: string,
  now: Date,
): Reminder[] {
  const { date: today, minute } = toLocal(now, timeZone);
  const reminders: Reminder[] = [];
  for (const p of people) {
    const mine = entries.filter((e) => e.staffId === p.staffId);
    const open = mine.find(isOpen) ?? null;
    const inMinute = (e: ClockEntry) => {
      const local = toLocal(e.clockIn, timeZone);
      return local.date === today ? local.minute : local.date < today ? -Infinity : Infinity;
    };
    const shifts = [...p.shifts].sort((a, b) => a.start - b.start);
    for (const s of shifts) {
      const late = minute >= s.start + REMIND_AFTER_MINUTES && minute < s.end;
      if (late && !open && !mine.some((e) => inMinute(e) >= s.start - 60 && inMinute(e) < s.end)) {
        reminders.push({ staffId: p.staffId, kind: "in", shiftStart: s.start, shiftEnd: s.end });
      }
    }
    if (open) {
      const ended = shifts.filter((s) => minute >= s.end + REMIND_AFTER_MINUTES && minute < s.end + OUT_REMINDER_HOURS * 60 && inMinute(open) < s.end).at(-1);
      const working = shifts.some((s) => s.start <= minute && minute < s.end);
      if (ended && !working) reminders.push({ staffId: p.staffId, kind: "out", shiftStart: ended.start, shiftEnd: ended.end });
    }
  }
  return reminders;
}

// The reminder's words (a fixed template, never AI).
export function reminderText(r: Pick<Reminder, "kind" | "shiftStart" | "shiftEnd">, format: (minute: number) => string): string {
  return r.kind === "in"
    ? `Your shift started at ${format(r.shiftStart)} and you haven't clocked in. Clock in on My day or at the front desk.`
    : `Your shift ended at ${format(r.shiftEnd)} and you're still clocked in. Clock out on My day or at the front desk.`;
}
