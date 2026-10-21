import { MINUTES_PER_DAY } from "./time";

// A span of wall-clock minutes within one day: [start, end).
export type Interval = { start: number; end: number };

export function sortIntervals(intervals: readonly Interval[]): Interval[] {
  return [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
}

// Merges overlapping or touching intervals.
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const i of sortIntervals(intervals)) {
    const last = merged.at(-1);
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else merged.push({ ...i });
  }
  return merged;
}

// Parts of `intervals` that fall inside `within`.
export function intersectIntervals(intervals: readonly Interval[], within: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const a of mergeIntervals(intervals)) {
    for (const b of mergeIntervals(within)) {
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (start < end) result.push({ start, end });
    }
  }
  return mergeIntervals(result);
}

// Parts of `intervals` not covered by `remove`.
export function subtractIntervals(intervals: readonly Interval[], remove: readonly Interval[]): Interval[] {
  let result = mergeIntervals(intervals);
  for (const r of mergeIntervals(remove)) {
    result = result.flatMap((i) => {
      if (r.end <= i.start || r.start >= i.end) return [i];
      const pieces: Interval[] = [];
      if (r.start > i.start) pieces.push({ start: i.start, end: r.start });
      if (r.end < i.end) pieces.push({ start: r.end, end: i.end });
      return pieces;
    });
  }
  return result;
}

// True when [start, end) lies entirely inside one interval.
export function containsSpan(intervals: readonly Interval[], start: number, end: number): boolean {
  return mergeIntervals(intervals).some((i) => i.start <= start && end <= i.end);
}

export function overlapsSpan(intervals: readonly Interval[], start: number, end: number): boolean {
  return intervals.some((i) => i.start < end && start < i.end);
}

export type IntervalError =
  | "invalid_time"
  | "not_five_minute_steps"
  | "start_not_before_end"
  | "overlapping";

// Checks a day's intervals as entered: valid minutes in 5-minute steps,
// each start before its end, no overlaps. Touching (1pm-1pm) is allowed.
export function validateIntervals(intervals: readonly Interval[]): IntervalError | null {
  for (const { start, end } of intervals) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > MINUTES_PER_DAY) return "invalid_time";
    if (start % 5 !== 0 || end % 5 !== 0) return "not_five_minute_steps";
    if (start >= end) return "start_not_before_end";
  }
  const sorted = sortIntervals(intervals);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return "overlapping";
  }
  return null;
}
