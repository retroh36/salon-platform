// Shift swaps, pure: who can swap with whom, and why a coworker can't take
// a shift (the same rules as `private.cant_take` and `private.swap_problem`
// in the database, which has the last word).
import type { Interval } from "./scheduling/intervals.ts";
import type { LocalDate } from "./scheduling/time.ts";

// Only the front desk and assistants swap: their days have no clients of
// their own to move. Always with someone in the same role.
export const SWAP_ROLES = ["front_desk", "assistant"] as const;
export type SwapRole = (typeof SWAP_ROLES)[number];

export function canSwap(role: string): role is SwapRole {
  return (SWAP_ROLES as readonly string[]).includes(role);
}

export function swapPartners<T extends { id: string; role: string; isActive?: boolean }>(me: { id: string; role: string }, team: readonly T[]): T[] {
  if (!canSwap(me.role)) return [];
  return team.filter((p) => p.id !== me.id && p.role === me.role && p.isActive !== false);
}

export function shiftsOverlap(a: readonly Interval[], b: readonly Interval[]): boolean {
  return a.some((x) => b.some((y) => x.start < y.end && y.start < x.end));
}

// What someone has on a day: their published hours, and approved time off
// (null minutes: the whole day).
export type SwapDay = { hours: Interval[]; timeOff: { startMinute: number | null; endMinute: number | null }[] };

// Why `name` (null: you) can't take these shifts on that day, or null.
export function cantTake(name: string | null, day: SwapDay, shifts: readonly Interval[], dateLabel: string): string | null {
  if (shiftsOverlap(day.hours, shifts)) return `${name ? `${name} is` : "You're"} already working then on ${dateLabel}.`;
  const off = day.timeOff.some((t) => t.startMinute == null || shiftsOverlap(shifts, [{ start: t.startMinute, end: t.endMinute! }]));
  if (off) return `${name ? `${name} has` : "You have"} time off on ${dateLabel}.`;
  return null;
}

// The swap as staff read it: "Sam gives Wed, Nov 4 (9am–5pm) to Jordan" and,
// for a swap, "and takes Jordan's Thu, Nov 5 (9am–5pm)".
export type SwapStatus = "asked" | "accepted" | "approved" | "declined" | "canceled";

export const SWAP_STATUS: Record<SwapStatus, { label: string; tone: "warning" | "info" | "success" | "neutral" }> = {
  asked: { label: "Waiting on coworker", tone: "warning" },
  accepted: { label: "Waiting on a manager", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  declined: { label: "Declined", tone: "neutral" },
  canceled: { label: "Canceled", tone: "neutral" },
};

// A day someone could offer: published hours from today, within the weeks ahead.
export function offerableDays(days: { date: LocalDate; hours: Interval[] }[], today: LocalDate): { date: LocalDate; hours: Interval[] }[] {
  return days.filter((d) => d.date >= today && d.hours.length > 0);
}
