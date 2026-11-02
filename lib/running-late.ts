// "Gil is running late": what that means for the stylist's day, worked out
// from the calendar (pure). With a client in their chair, that visit runs
// over (Denise's overrun fixes); with nobody in it yet, they're coming in
// late (Mark out's "Coming in late…", which plans each client before
// anything moves); with no clients left, nothing needs to move.

// The choices offered, as report_running_late takes them (5-minute steps).
export const LATE_CHOICES = [5, 10, 15, 20, 30, 45, 60] as const;

type Block = { itemId: string; staffId: string; start: number; end: number; status: string; clientName: string; service: string };

export type LateTarget =
  | { kind: "in_chair"; itemId: string; clientName: string; service: string; end: number }
  | { kind: "next"; itemId: string; clientName: string; service: string; start: number }
  | { kind: "none" };

// `nowMinute` is null on a day that isn't today: then the day's first
// visit not yet started is "next".
export function lateTarget(blocks: readonly Block[], staffId: string, nowMinute: number | null): LateTarget {
  const theirs = blocks.filter((b) => b.staffId === staffId).sort((a, b) => a.start - b.start);
  const inChair = theirs.filter((b) => b.status === "checked_in" && (nowMinute === null || b.start <= nowMinute)).at(-1);
  if (inChair) return { kind: "in_chair", itemId: inChair.itemId, clientName: inChair.clientName, service: inChair.service, end: inChair.end };
  const next = theirs.find((b) => (b.status === "booked" || b.status === "confirmed") && (nowMinute === null || b.end > nowMinute));
  if (next) return { kind: "next", itemId: next.itemId, clientName: next.clientName, service: next.service, start: next.start };
  return { kind: "none" };
}

// The nearest choice at or over what was said ("12 minutes" is 15), at
// most an hour.
export function lateChoice(minutes: number): number {
  return LATE_CHOICES.find((m) => m >= minutes) ?? 60;
}

// When they'd be in, coming in late: late for their next client (or for
// now, once that client's time has come), on the quarter hour after.
export function arrivesAt(target: LateTarget, nowMinute: number | null, minutes: number): number | null {
  if (target.kind !== "next") return null;
  const from = nowMinute === null ? target.start : Math.max(nowMinute, target.start);
  return Math.ceil((from + minutes) / 15) * 15;
}
