// Goals and pacing (pure, unit-tested; runs under plain Node). A goal is a
// target for one stylist and one measure over a week, month, quarter or
// year. Pacing works out, from our own numbers only: progress, what's
// already booked, working days left from their schedule, exactly what's
// needed per working day, and whether they're ahead, on pace or behind.
// Denise's wording is in ./wording.ts; Claude never sees or makes these.

import type { Interval } from "../scheduling/intervals.ts";
import { addDays, startOfWeek, type LocalDate } from "../scheduling/time.ts";

export type GoalMetric = "service_revenue" | "retail_revenue" | "rebooking_rate" | "new_clients" | "average_ticket";
export type GoalPeriod = "week" | "month" | "quarter" | "year";

export const GOAL_METRICS: { value: GoalMetric; label: string; unit: "cents" | "percent" | "count" }[] = [
  { value: "service_revenue", label: "Service revenue", unit: "cents" },
  { value: "retail_revenue", label: "Retail sales", unit: "cents" },
  { value: "rebooking_rate", label: "Rebooking", unit: "percent" },
  { value: "new_clients", label: "New clients", unit: "count" },
  { value: "average_ticket", label: "Average ticket", unit: "cents" },
];
export const GOAL_PERIODS: { value: GoalPeriod; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];
export const metricInfo = (m: GoalMetric) => GOAL_METRICS.find((x) => x.value === m)!;

export type Goal = { id: string; staffId: string; metric: GoalMetric; period: GoalPeriod; target: number };

// The week (Monday to Sunday), month, quarter or year containing a date.
export function goalPeriod(kind: GoalPeriod, date: LocalDate): { from: LocalDate; to: LocalDate } {
  const [y, m] = date.split("-").map(Number);
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01` as LocalDate;
  const nextMonth = (yy: number, mm: number) => (mm === 12 ? first(yy + 1, 1) : first(yy, mm + 1));
  if (kind === "week") {
    const from = startOfWeek(date);
    return { from, to: addDays(from, 6) };
  }
  if (kind === "month") return { from: first(y, m), to: addDays(nextMonth(y, m), -1) };
  if (kind === "quarter") {
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: first(y, q), to: addDays(q + 3 > 12 ? first(y + 1, 1) : first(y, q + 3), -1) };
  }
  return { from: first(y, 1), to: `${y}-12-31` as LocalDate };
}

// Working days in the period from their schedule (`available` time each
// day, salon hours and time off already applied): how many in all, how
// many are behind them, and which are left. Today is left while some of
// their working time is still ahead of `nowMinute`.
export function workingDays(days: readonly { date: LocalDate; available: readonly Interval[] }[], today: LocalDate, nowMinute: number): { total: number; elapsed: number; left: LocalDate[] } {
  const working = days.filter((d) => d.available.length > 0);
  const left = working.filter((d) => d.date > today || (d.date === today && d.available.some((i) => i.end > nowMinute))).map((d) => d.date);
  return { total: working.length, elapsed: working.length - left.length, left };
}

// What our code measured so far in the period, and what's booked ahead.
export type Progress = {
  // Revenue after discounts, before tax (cents), or new clients (count).
  achieved: number;
  // Services already booked for the rest of the period (cents), or new
  // clients booked.
  bookedAhead: number;
  // For rates: visits checked out, rebooked, revenue and tickets so far,
  // and visits still booked in the period.
  visits: number;
  rebooked: number;
  revenueCents: number;
  tickets: number;
  upcomingVisits: number;
};

export type PaceStatus = "hit" | "ahead" | "on_pace" | "behind";

export type Pacing = {
  goal: Goal;
  from: LocalDate;
  to: LocalDate;
  // In the metric's unit: cents, whole percent, or a count.
  current: number | null;
  target: number;
  // Of the target, 0 and up (a rate's current value against it).
  percent: number;
  status: PaceStatus;
  daysTotal: number;
  daysLeft: number;
  // Sum measures: still needed, needed per working day left (exact cents
  // or a count), and what's booked toward it.
  remaining: number;
  perDay: number | null;
  bookedAhead: number;
  // Rates: rebooks needed of the visits booked ahead, or the average the
  // rest of their visits need.
  neededRebooks: number | null;
  neededAverage: number | null;
  // When a rate can't reach its target even if every visit left goes
  // perfectly: the best it can still be.
  bestRate: number | null;
  upcomingVisits: number;
  // The highest of 50, 75 and 100 (goal hit) reached, else 0. A rate only
  // counts as hit once its period is over.
  milestone: 0 | 50 | 75 | 100;
};

// Ahead or behind by more than a tenth of where they'd be at an even pace.
export const PACE_BAND = 0.1;

const milestoneOf = (percent: number): Pacing["milestone"] => (percent >= 100 ? 100 : percent >= 75 ? 75 : percent >= 50 ? 50 : 0);

export function pace(goal: Goal, period: { from: LocalDate; to: LocalDate }, progress: Progress, days: { total: number; elapsed: number; left: LocalDate[] }): Pacing {
  const base = { goal, from: period.from, to: period.to, target: goal.target, daysTotal: days.total, daysLeft: days.left.length, upcomingVisits: progress.upcomingVisits };
  if (goal.metric === "rebooking_rate" || goal.metric === "average_ticket") {
    const rebooking = goal.metric === "rebooking_rate";
    const current = rebooking ? (progress.visits ? Math.round((progress.rebooked / progress.visits) * 100) : null) : progress.tickets ? Math.round(progress.revenueCents / progress.tickets) : null;
    const percent = current === null || goal.target <= 0 ? 0 : Math.round((current / goal.target) * 100);
    const done = days.left.length === 0;
    const status: PaceStatus = current === null ? "on_pace" : current >= goal.target ? (done ? "hit" : "ahead") : current >= goal.target * (1 - PACE_BAND / 2) ? "on_pace" : "behind";
    // What the rest needs: rebooks of the visits still booked, or their average.
    const total = (rebooking ? progress.visits : progress.tickets) + progress.upcomingVisits;
    const needed = rebooking && current !== null && current < goal.target ? Math.max(0, Math.ceil((goal.target / 100) * total - progress.rebooked)) : null;
    const neededRebooks = needed !== null && needed <= progress.upcomingVisits ? needed : null;
    const bestRate = needed !== null && needed > progress.upcomingVisits ? Math.floor(((progress.rebooked + progress.upcomingVisits) / total) * 100) : null;
    const neededAverage =
      !rebooking && current !== null && current < goal.target && progress.upcomingVisits > 0 ? Math.ceil((goal.target * total - progress.revenueCents) / progress.upcomingVisits) : null;
    return { ...base, current, percent, status, remaining: 0, perDay: null, bookedAhead: 0, neededRebooks, neededAverage, bestRate, milestone: status === "hit" ? 100 : 0 };
  }
  const achieved = progress.achieved;
  const remaining = Math.max(0, goal.target - achieved);
  const percent = goal.target > 0 ? Math.floor((achieved / goal.target) * 100) : 0;
  const expected = days.total > 0 ? (goal.target * days.elapsed) / days.total : 0;
  const status: PaceStatus =
    achieved >= goal.target ? "hit" : expected === 0 ? (achieved > 0 ? "ahead" : "on_pace") : achieved >= expected * (1 + PACE_BAND) ? "ahead" : achieved < expected * (1 - PACE_BAND) ? "behind" : "on_pace";
  return {
    ...base,
    current: achieved,
    percent,
    status,
    remaining,
    perDay: remaining > 0 && days.left.length > 0 ? Math.ceil(remaining / days.left.length) : remaining > 0 ? null : 0,
    bookedAhead: progress.bookedAhead,
    neededRebooks: null,
    neededAverage: null,
    bestRate: null,
    milestone: milestoneOf(percent),
  };
}

// A goal's target from the form: dollars, a whole percent or a count.
export function parseTarget(metric: GoalMetric, text: string): number | string {
  const t = text.trim().replace(/[$,%\s]/g, "");
  const unit = metricInfo(metric).unit;
  if (unit === "cents") {
    const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(t);
    const cents = m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : 0;
    return cents > 0 ? cents : "Enter an amount like 9000.";
  }
  const n = /^\d{1,5}$/.test(t) ? Number(t) : 0;
  if (unit === "percent") return n >= 1 && n <= 100 ? n : "Enter a percentage from 1 to 100.";
  return n >= 1 && n <= 10000 ? n : "Enter a number from 1 up.";
}

export type AlertFrequency = "daily" | "weekly";

// Denise's goal alert comes up once a day, or once a week (from Monday),
// until they've read it.
export function alertDue(frequency: AlertFrequency, seenOn: LocalDate | null, today: LocalDate): boolean {
  if (!seenOn) return true;
  return frequency === "daily" ? seenOn < today : seenOn < startOfWeek(today);
}
