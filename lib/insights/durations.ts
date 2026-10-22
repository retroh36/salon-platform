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
const TREND_TAU = 0.25;

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

// The latest third of visits against the earliest third. It's a trend when
// the change is big enough and visits move that way consistently over
// time (Kendall's tau at least TREND_TAU), not just two noisy groups.
export function trendOf(samples: readonly DurationSample[]): { trend: Trend; minutes: number } {
  if (samples.length < TREND_VISITS) return { trend: "steady", minutes: 0 };
  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const third = Math.floor(ordered.length / 3);
  const early = median(ordered.slice(0, third).map((s) => s.actualMinutes))!;
  const late = median(ordered.slice(-third).map((s) => s.actualMinutes))!;
  const change = late - early;
  const threshold = Math.max(TREND_MINUTES, early * TREND_SHARE);
  const tau = kendallTau(ordered.map((s) => s.actualMinutes));
  if (Math.abs(change) < threshold || Math.abs(tau) < TREND_TAU || Math.sign(tau) !== Math.sign(change)) return { trend: "steady", minutes: Math.round(change) };
  return { trend: change < 0 ? "faster" : "slower", minutes: Math.round(change) };
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
export function stylistDurations(samples: readonly DurationSample[], menuMinutes: ReadonlyMap<string, number>): DurationInsight[] {
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
    const { trend, minutes } = trendOf(keptSamples);
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
