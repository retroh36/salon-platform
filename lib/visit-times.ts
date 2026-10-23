// Actual times on a service: which one-tap action comes next, and how long
// it really took; and for a whole visit, the one main thing to do next and
// its status in words. Pure; recorded by record_item_time.

import type { AppointmentStatus } from "@/lib/appointments";
import { formatMinutes } from "@/lib/services";
import { formatMinute, toLocal } from "@/lib/scheduling/time";

export type ItemTimes = {
  startedAt: string | null;
  processingStartedAt: string | null;
  processingEndedAt: string | null;
  finishedAt: string | null;
};

export type TimeEvent = "start" | "processing" | "rinse" | "finish" | "undo";

export const EVENT_LABELS: Record<Exclude<TimeEvent, "undo">, string> = {
  start: "Start service",
  processing: "Processing",
  rinse: "Back in chair",
  finish: "Finish service",
};

export type TimerState = "waiting" | "in_chair" | "processing" | "finishing" | "done";

export function timerState(t: ItemTimes): TimerState {
  if (t.finishedAt) return "done";
  if (t.processingEndedAt) return "finishing";
  if (t.processingStartedAt) return "processing";
  if (t.startedAt) return "in_chair";
  return "waiting";
}

// The taps that make sense now, the main one first. Services with a
// processing gap offer "Processing" once started; others go straight to
// "Finished".
export function nextEvents(t: ItemTimes, hasProcessing: boolean): Exclude<TimeEvent, "undo">[] {
  switch (timerState(t)) {
    case "waiting":
      return ["start"];
    case "in_chair":
      return hasProcessing ? ["processing", "finish"] : ["finish"];
    case "processing":
      return ["rinse"];
    case "finishing":
      return ["finish"];
    case "done":
      return [];
  }
}

const minutesBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);

// Start to finish, in whole minutes, once it's finished.
export function actualMinutes(t: ItemTimes): number | null {
  return t.startedAt && t.finishedAt ? minutesBetween(t.startedAt, t.finishedAt) : null;
}

// How far it ran over (positive) or under (negative) what was booked.
export function overrunMinutes(t: ItemTimes, bookedMinutes: number): number | null {
  const actual = actualMinutes(t);
  return actual === null ? null : actual - bookedMinutes;
}

// Minutes since a tap, for "Started 12 min ago".
export function sinceMinutes(at: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(at).getTime()) / 60_000));
}

const clockAt = (at: string, timeZone: string) => formatMinute(toLocal(new Date(at), timeZone).minute);

// A service's progress in words: "In service since 10:52am",
// "Processing since 11:10am", "Finished at 12:05pm · 1h 13m, 5m over".
export function timerStatus(t: ItemTimes, bookedMinutes: number, timeZone: string): string {
  switch (timerState(t)) {
    case "waiting":
      return "Not started";
    case "in_chair":
      return `In service since ${clockAt(t.startedAt!, timeZone)}`;
    case "processing":
      return `Processing since ${clockAt(t.processingStartedAt!, timeZone)}`;
    case "finishing":
      return `Back in the chair since ${clockAt(t.processingEndedAt!, timeZone)}`;
    case "done": {
      const actual = actualMinutes(t);
      const diff = actual === null ? 0 : actual - bookedMinutes;
      const took = actual === null ? "" : ` · ${formatMinutes(actual)}${Math.abs(diff) >= 3 ? `, ${formatMinutes(Math.abs(diff))} ${diff > 0 ? "over" : "under"}` : ""}`;
      return `Finished at ${clockAt(t.finishedAt!, timeZone)}${took}`;
    }
  }
}

export type VisitItem = { id: string; start: number; times: ItemTimes; hasProcessing: boolean; canRecord: boolean };

// The one main action on a visit, by where it's at: Booked → Check in;
// checked in → the next tap on the first service not finished (Start
// service, Processing, Back in chair, Finish service); every service
// finished → Check out. Null when there's nothing for this person to do.
export type NextStep = { kind: "check_in" } | { kind: "check_out" } | { kind: "tap"; itemId: string; event: Exclude<TimeEvent, "undo"> };

export function nextStep(status: AppointmentStatus, items: readonly VisitItem[], canBook: boolean): NextStep | null {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const tap = (): NextStep | null => {
    const item = sorted.find((i) => i.canRecord && timerState(i.times) !== "done");
    return item ? { kind: "tap", itemId: item.id, event: nextEvents(item.times, item.hasProcessing)[0] } : null;
  };
  if (status === "booked" || status === "confirmed") return canBook ? { kind: "check_in" } : tap();
  if (status !== "checked_in") return null;
  return tap() ?? (canBook ? { kind: "check_out" } : null);
}

// The visit's status as text, apart from the buttons: "Booked",
// "Checked in at 10:40am", "In service since 10:52am", "Finished at
// 12:05pm", "Checked out at 12:20pm".
export function visitStatusText(
  status: AppointmentStatus,
  labels: Record<AppointmentStatus, string>,
  visit: { checkedInAt: string | null; checkedOutAt: string | null; items: readonly { start: number; times: ItemTimes }[] },
  timeZone: string,
): string {
  if (status === "completed") return visit.checkedOutAt ? `Checked out at ${clockAt(visit.checkedOutAt, timeZone)}` : labels.completed;
  if (status !== "checked_in") return labels[status];
  const sorted = [...visit.items].sort((a, b) => a.start - b.start);
  const current = sorted.find((i) => i.times.startedAt && !i.times.finishedAt);
  if (current) return timerStatus(current.times, 0, timeZone);
  const finished = sorted.map((i) => i.times.finishedAt).filter((f): f is string => !!f);
  if (finished.length === sorted.length) return `Finished at ${clockAt(finished.sort().at(-1)!, timeZone)}`;
  return visit.checkedInAt ? `Checked in at ${clockAt(visit.checkedInAt, timeZone)}` : labels.checked_in;
}
