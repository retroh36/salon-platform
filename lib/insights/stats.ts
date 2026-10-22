// Small statistics for the learning engine. Pure; runs under plain Node.

export function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

// Linear interpolation between closest ranks (like a spreadsheet's
// PERCENTILE.INC).
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Drops values far outside the rest (Tukey's fences, 1.5 × the
// interquartile range beyond the quartiles). Needs at least 5 values to
// judge; fewer are kept as they are.
export function withoutOutliers(values: readonly number[]): { kept: number[]; dropped: number[] } {
  if (values.length < 5) return { kept: [...values], dropped: [] };
  const q1 = quantile(values, 0.25)!;
  const q3 = quantile(values, 0.75)!;
  const fence = 1.5 * (q3 - q1);
  const kept: number[] = [];
  const dropped: number[] = [];
  for (const v of values) (v < q1 - fence || v > q3 + fence ? dropped : kept).push(v);
  return { kept, dropped };
}

// The most common value and its share, or null when nothing is common
// enough (below minShare) or there are no values.
export function mode<T>(values: readonly T[], minShare = 0): { value: T; share: number } | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  const share = bestCount / values.length;
  return share >= minShare ? { value: best as T, share } : null;
}

export const round = (value: number, places = 0) => Math.round(value * 10 ** places) / 10 ** places;

// Up to the next multiple of `step` (booking lengths are in 5 minutes).
export const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step;

export const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);
