// A client's habits, from their visits: how often they come and when
// they're next due, who and when they like, what they usually have, how
// reliable they are, what they spend, and whether they're drifting away.
// Pure; runs under plain Node. Every number here comes from the visits.

import { mode, median, ratio } from "./stats.ts";

export type VisitStatus = "booked" | "confirmed" | "checked_in" | "completed" | "canceled" | "no_show";

export type ClientVisit = {
  appointmentId: string;
  start: Date;
  // Local to the salon: ISO weekday (1 = Monday) and minutes since midnight.
  weekday: number;
  minute: number;
  status: VisitStatus;
  staffIds: string[];
  serviceIds: string[];
  // Minutes after the booked start they checked in (null if not known).
  minutesLate: number | null;
  // Services at the prices booked, and retail bought at the visit.
  serviceCents: number;
  retailCents: number;
};

// Late means checked in this many minutes after the booked start.
export const LATE_MINUTES = 10;
// Due soon: within this many days of their usual gap.
export const DUE_SOON_DAYS = 7;
// The default gap when there's only one visit to go on.
export const DEFAULT_INTERVAL_DAYS = 42;

export type DueStatus = "booked" | "not_due" | "due_soon" | "overdue" | "lapsed" | "new";
export type ChurnRisk = "low" | "medium" | "high";
export type TimeOfDay = "morning" | "afternoon" | "evening";

export type ClientInsight = {
  visits: number;
  firstVisit: string | null;
  lastVisit: string | null;
  // Their usual gap between visits (median), and whether it's from enough
  // visits to rely on (3 or more).
  intervalDays: number | null;
  intervalTrusted: boolean;
  nextDue: string | null;
  // Days past due (0 if not).
  overdueDays: number;
  due: DueStatus;
  nextBooked: string | null;
  preferredStaffId: string | null;
  preferredStaffShare: number | null;
  preferredWeekday: number | null;
  timeOfDay: TimeOfDay | null;
  usualServiceIds: string[];
  lateRate: number | null;
  cancelRate: number | null;
  noShowRate: number | null;
  retailRate: number | null;
  lifetimeSpendCents: number;
  averageVisitCents: number | null;
  // The latest gap compared with their usual one (1.0 = the same).
  gapGrowth: number | null;
  churnRisk: ChurnRisk;
};

const DAY = 86_400_000;
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

export function timeOfDay(minute: number): TimeOfDay {
  return minute < 12 * 60 ? "morning" : minute < 17 * 60 ? "afternoon" : "evening";
}

export function clientInsight(visits: readonly ClientVisit[], asOf: Date): ClientInsight {
  const ordered = [...visits].sort((a, b) => a.start.getTime() - b.start.getTime());
  const done = ordered.filter((v) => v.status === "completed" && v.start <= asOf);
  const upcoming = ordered.filter((v) => (v.status === "booked" || v.status === "confirmed" || v.status === "checked_in") && v.start > asOf);

  const gaps = done.slice(1).map((v, i) => days(done[i].start, v.start)).filter((g) => g > 0);
  const interval = gaps.length ? median(gaps)! : done.length ? DEFAULT_INTERVAL_DAYS : null;
  const last = done.at(-1);
  const nextDue = last && interval !== null ? new Date(last.start.getTime() + interval * DAY) : null;
  const overdue = nextDue ? Math.max(0, days(nextDue, asOf)) : 0;

  let due: DueStatus;
  if (!last) due = "new";
  else if (upcoming.length) due = "booked";
  else if (interval !== null && overdue > interval) due = "lapsed";
  else if (overdue > 0) due = "overdue";
  else if (nextDue && days(asOf, nextDue) <= DUE_SOON_DAYS) due = "due_soon";
  else due = "not_due";

  // The latest gap (or the time since their last visit, if that's longer)
  // against their usual gap before it.
  const earlier = gaps.length > 1 ? median(gaps.slice(0, -1))! : null;
  const latest = Math.max(gaps.at(-1) ?? 0, last && !upcoming.length ? days(last.start, asOf) : 0);
  const gapGrowth = earlier && latest ? latest / earlier : null;
  let churnRisk: ChurnRisk = "low";
  if (due === "lapsed" || (gapGrowth !== null && gapGrowth >= 1.8)) churnRisk = "high";
  else if ((interval !== null && overdue > interval / 2) || (gapGrowth !== null && gapGrowth >= 1.3)) churnRisk = "medium";
  if (upcoming.length) churnRisk = "low";

  const stylist = mode(done.flatMap((v) => v.staffIds.slice(0, 1)), 0.4);
  const weekday = mode(done.map((v) => v.weekday), 0.4);
  const time = mode(done.map((v) => timeOfDay(v.minute)), 0.5);
  const serviceCounts = new Map<string, number>();
  for (const v of done) for (const s of new Set(v.serviceIds)) serviceCounts.set(s, (serviceCounts.get(s) ?? 0) + 1);
  const usual = [...serviceCounts]
    .filter(([, c]) => c / done.length >= 0.3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s]) => s);

  const past = ordered.filter((v) => v.start <= asOf);
  const arrived = done.filter((v) => v.minutesLate !== null);
  const spend = done.reduce((sum, v) => sum + v.serviceCents + v.retailCents, 0);

  return {
    visits: done.length,
    firstVisit: done[0]?.start.toISOString() ?? null,
    lastVisit: last?.start.toISOString() ?? null,
    intervalDays: interval,
    intervalTrusted: gaps.length >= 2,
    nextDue: nextDue?.toISOString() ?? null,
    overdueDays: overdue,
    due,
    nextBooked: upcoming[0]?.start.toISOString() ?? null,
    preferredStaffId: stylist?.value ?? null,
    preferredStaffShare: stylist?.share ?? null,
    preferredWeekday: weekday?.value ?? null,
    timeOfDay: time?.value ?? null,
    usualServiceIds: usual,
    lateRate: ratio(arrived.filter((v) => v.minutesLate! >= LATE_MINUTES).length, arrived.length),
    cancelRate: ratio(ordered.filter((v) => v.status === "canceled").length, ordered.length),
    noShowRate: ratio(past.filter((v) => v.status === "no_show").length, past.filter((v) => v.status === "no_show" || v.status === "completed").length),
    retailRate: ratio(done.filter((v) => v.retailCents > 0).length, done.length),
    lifetimeSpendCents: spend,
    averageVisitCents: done.length ? Math.round(spend / done.length) : null,
    gapGrowth: gapGrowth === null ? null : Math.round(gapGrowth * 100) / 100,
    churnRisk,
  };
}
