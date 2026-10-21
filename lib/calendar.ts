// Layout for the day-view calendar: the time range shown, colors for
// service categories, and how overlapping blocks sit in a column. Display
// only; whether a booking is allowed is decided in lib/scheduling/booking.ts.

import { subtractIntervals, type Interval } from "@/lib/scheduling/intervals";
import { MINUTES_PER_DAY } from "@/lib/scheduling/time";

// Distinct from each other, and readable as a tint behind dark text.
export const CATEGORY_PALETTE = ["#2563eb", "#db2777", "#059669", "#7c3aed", "#d97706", "#0891b2", "#dc2626", "#4f46e5"];

// One color per category, in alphabetical order, so the same menu always
// gets the same colors. Repeats after eight categories.
export function categoryColors(categories: readonly string[]): Map<string, string> {
  const sorted = [...new Set(categories)].sort((a, b) => a.localeCompare(b));
  return new Map(sorted.map((c, i) => [c, CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]]));
}

// The hours to draw: the salon's opening hours that day (or `fallback`, e.g.
// the week's hours, when closed), stretched to fit any appointments, in
// whole hours.
export function gridRange(open: readonly Interval[], fallback: readonly Interval[], items: readonly Interval[]): Interval {
  const base = open.length ? open : fallback;
  const all = [...base, ...items];
  if (all.length === 0) return { start: 9 * 60, end: 17 * 60 };
  const start = Math.min(...all.map((i) => i.start));
  const end = Math.max(...all.map((i) => i.end));
  return { start: Math.floor(start / 60) * 60, end: Math.min(MINUTES_PER_DAY, Math.ceil(end / 60) * 60) };
}

// Parts of the range when the stylist can't be booked.
export function offHours(range: Interval, bookable: readonly Interval[]): Interval[] {
  return subtractIntervals([range], bookable);
}

// Hours to label on the time axis.
export function hourMarks(range: Interval): number[] {
  const marks: number[] = [];
  for (let m = Math.ceil(range.start / 60) * 60; m < range.end; m += 60) marks.push(m);
  return marks;
}

// How far to indent each block: blocks that start while an earlier one is
// still running (a client booked into a processing gap, or a clash) sit
// one step further in, so both stay visible. Longer blocks go first when two
// start together.
export function layoutColumn<T extends Interval>(blocks: readonly T[]): (T & { depth: number })[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: (T & { depth: number })[] = [];
  for (const block of sorted) {
    const running = placed.filter((p) => p.start <= block.start && block.start < p.end);
    const used = new Set(running.map((p) => p.depth));
    let depth = 0;
    while (used.has(depth)) depth++;
    placed.push({ ...block, depth });
  }
  return placed;
}
