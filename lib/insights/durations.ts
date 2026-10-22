// How long each stylist really takes for each service, from the actual
// times tapped in (start to finish), compared with what's booked and the
// menu. Pure; runs under plain Node.
//
// A figure is only trusted after MIN_VISITS visits (outliers set aside),
// and Denise only suggests a new length when it's trusted and differs
// from the menu by SUGGEST_DIFFERENCE or more.

import { ceilTo, median, quantile, ratio, withoutOutliers } from "./stats.ts";

export const MIN_VISITS = 5;
// A visit "ran over" when it took this much longer than booked.
export const OVERRUN_MINUTES = 5;
// Suggest a length when the typical time is this far from the menu's.
export const SUGGEST_DIFFERENCE = 10;
// A trend needs this many visits, and a change this big (minutes, or this
// share of the typical time, whichever is larger).
const TREND_VISITS = 12;
const TREND_MINUTES = 5;
const TREND_SHARE = 0.08;
// Mann-Kendall test: |z| at least this (about 99.7% confidence). Stricter
// than the usual 95% because a salon has around a hundred stylist and
// service pairs, and at 95% about five of them would look like trends by
// chance alone.
const TREND_Z = 3;
// And enough recent visits: this many in the last TREND_RECENT_DAYS.
const TREND_RECENT_VISITS = 5;
const TREND_RECENT_DAYS = 60;

export type DurationSample = {
  staffId: string;
  serviceId: string;
  // What was booked, and start to finish as tapped in.
  bookedMinutes: number;
  actualMinutes: number;
  at: Date;
};

export type Consistency = "steady" | "varies" | "unpredictable";
export type Trend = "faster" | "slower" | "steady";

export type DurationInsight = {
  staffId: string;
  serviceId: string;
  // Visits counted, and those set aside as outliers.
  visits: number;
  outliers: number;
  trusted: boolean;
  medianMinutes: number;
  // The middle half of visits took between these.
  p25Minutes: number;
  p75Minutes: number;
  consistency: Consistency;
  trend: Trend;
  // Recent visits compared with the earliest ones (negative is faster).
  trendMinutes: number;
  menuMinutes: number;
  bookedMinutes: number;
  // Share of visits that ran over what was booked.
  overrunRate: number;
  // A length to book instead of the menu's, when there's good reason.
  suggestedMinutes: number | null;
  lastVisit: string;
};

// IQR relative to the typical time: under 10% is steady, under 20% varies.
export function consistencyOf(p25: number, p75: number, typical: number): Consistency {
  const spread = typical > 0 ? (p75 - p25) / typical : 0;
  return spread < 0.1 ? "steady" : spread < 0.2 ? "varies" : "unpredictable";
}

// The latest third of visits against the earliest third. It's only called
// a trend when it's statistically meaningful: big enough (5 minutes or 8%),
// significant over time (Mann-Kendall test, |z| ≥ 3), from at least
// TREND_VISITS visits with TREND_RECENT_VISITS in the last
// TREND_RECENT_DAYS days. Anything less is "steady".
export function trendOf(samples: readonly DurationSample[], asOf = new Date()): { trend: Trend; minutes: number } {
  if (samples.length < TREND_VISITS) return { trend: "steady", minutes: 0 };
  const recent = samples.filter((s) => asOf.getTime() - s.at.getTime() <= TREND_RECENT_DAYS * 86_400_000).length;
  if (recent < TREND_RECENT_VISITS) return { trend: "steady", minutes: 0 };
  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const third = Math.floor(ordered.length / 3);
  const early = median(ordered.slice(0, third).map((s) => s.actualMinutes))!;
  const late = median(ordered.slice(-third).map((s) => s.actualMinutes))!;
  const change = late - early;
  const threshold = Math.max(TREND_MINUTES, early * TREND_SHARE);
  const z = mannKendallZ(ordered.map((s) => s.actualMinutes));
  if (Math.abs(change) < threshold || Math.abs(z) < TREND_Z || Math.sign(z) !== Math.sign(change)) return { trend: "steady", minutes: Math.round(change) };
  return { trend: change < 0 ? "faster" : "slower", minutes: Math.round(change) };
}

// The Mann-Kendall test statistic for a trend in values over time: S (rises
// minus falls over all pairs) scaled by its spread under "no trend", with
// the usual continuity correction and an adjustment for ties. Beyond ±1.96
// is a trend at 95% confidence; we ask for more (TREND_Z).
export function mannKendallZ(values: readonly number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s += Math.sign(values[j] - values[i]);
  const ties = new Map<number, number>();
  for (const v of values) ties.set(v, (ties.get(v) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) tieTerm += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  if (variance <= 0 || s === 0) return 0;
  return (s - Math.sign(s)) / Math.sqrt(variance);
}

// How consistently values rise (1) or fall (-1) in order: concordant minus
// discordant pairs, over all pairs.
export function kendallTau(values: readonly number[]): number {
  let score = 0;
  let pairs = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      score += Math.sign(values[j] - values[i]);
      pairs++;
    }
  }
  return pairs ? score / pairs : 0;
}

// One insight per stylist and service with any timed visits. menuMinutes
// is each service's length on the menu.
export function stylistDurations(samples: readonly DurationSample[], menuMinutes: ReadonlyMap<string, number>, asOf = new Date()): DurationInsight[] {
  const groups = new Map<string, DurationSample[]>();
  for (const s of samples) {
    if (!(s.actualMinutes > 0)) continue;
    const key = `${s.staffId}:${s.serviceId}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const insights: DurationInsight[] = [];
  for (const group of groups.values()) {
    const { kept, dropped } = withoutOutliers(group.map((s) => s.actualMinutes));
    const keptSamples = group.filter((s) => kept.includes(s.actualMinutes));
    const typical = median(kept)!;
    const p25 = quantile(kept, 0.25)!;
    const p75 = quantile(kept, 0.75)!;
    const menu = menuMinutes.get(group[0].serviceId) ?? median(group.map((s) => s.bookedMinutes))!;
    const trusted = kept.length >= MIN_VISITS;
    const suggested = ceilTo(typical, 5);
    const { trend, minutes } = trendOf(keptSamples, asOf);
    insights.push({
      staffId: group[0].staffId,
      serviceId: group[0].serviceId,
      visits: kept.length,
      outliers: dropped.length,
      trusted,
      medianMinutes: Math.round(typical),
      p25Minutes: Math.round(p25),
      p75Minutes: Math.round(p75),
      consistency: consistencyOf(p25, p75, typical),
      trend,
      trendMinutes: minutes,
      menuMinutes: menu,
      bookedMinutes: Math.round(median(group.map((s) => s.bookedMinutes))!),
      overrunRate: ratio(group.filter((s) => s.actualMinutes > s.bookedMinutes + OVERRUN_MINUTES).length, group.length) ?? 0,
      suggestedMinutes: trusted && Math.abs(typical - menu) >= SUGGEST_DIFFERENCE ? suggested : null,
      lastVisit: new Date(Math.max(...group.map((s) => s.at.getTime()))).toISOString(),
    });
  }
  return insights.sort((a, b) => a.staffId.localeCompare(b.staffId) || a.serviceId.localeCompare(b.serviceId));
}
