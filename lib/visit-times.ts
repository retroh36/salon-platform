// Actual times on a service: which one-tap action comes next, and how long
// it really took. Pure; recorded by record_item_time.

export type ItemTimes = {
  startedAt: string | null;
  processingStartedAt: string | null;
  processingEndedAt: string | null;
  finishedAt: string | null;
};

export type TimeEvent = "start" | "processing" | "rinse" | "finish" | "undo";

export const EVENT_LABELS: Record<Exclude<TimeEvent, "undo">, string> = {
  start: "Started",
  processing: "Processing",
  rinse: "Back in chair",
  finish: "Finished",
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
