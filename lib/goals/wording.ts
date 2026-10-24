// Denise's goal alerts and suggestions, in her voice, worded by our code
// from the numbers in ./pacing.ts (never by Claude): one line per goal,
// a celebration at 50%, 75% and the goal, and concrete things to do from
// real data (overdue regulars, open gaps, clients who usually buy retail).

import { formatMinute, type LocalDate } from "../scheduling/time.ts";
import { metricInfo, type GoalPeriod, type Pacing } from "./pacing.ts";

const whole = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
// Exact, to the cent when there are cents: "$311.12", "$450".
const exact = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "$6,200", "58%", "3".
export function goalValue(p: Pick<Pacing, "goal">, value: number | null): string {
  if (value === null) return "—";
  const unit = metricInfo(p.goal.metric).unit;
  return unit === "cents" ? whole(value) : unit === "percent" ? `${value}%` : String(value);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// "this week", "November", "Q4", "2026".
export function periodName(kind: GoalPeriod, from: LocalDate): string {
  const [y, m] = from.split("-").map(Number);
  if (kind === "week") return "this week";
  if (kind === "month") return MONTHS[m - 1];
  if (kind === "quarter") return `Q${Math.floor((m - 1) / 3) + 1}`;
  return String(y);
}

export const STATUS_LABELS = { hit: "Goal hit", ahead: "Ahead", on_pace: "On pace", behind: "Behind" } as const;

// Her one line on a goal, to the stylist ("you"), or about them for the
// owners' team view (`who`, a first name):
// "You're on pace — $6,200 of $9,000 with 9 working days left; you need
// $311/day and you have $2,400 already booked."
export function goalLine(p: Pacing, who?: string): string {
  const v = who
    ? { is: `${who}'s`, need: "needs", have: "has", your: "their", hit: `${who} hit the goal`, rebook: "rebooking" }
    : { is: "You're", need: "you need", have: "you have", your: "your", hit: "Goal hit", rebook: "rebook" };
  const status = { ahead: `${v.is} ahead`, on_pace: `${v.is} on pace`, behind: `${v.is} a little behind` } as const;
  const what = metricInfo(p.goal.metric).label.toLowerCase();
  const of = `${goalValue(p, p.current)} of ${goalValue(p, p.target)}`;
  const left = p.daysLeft ? `with ${plural(p.daysLeft, "working day")} left` : "and the period's over";
  if (p.status === "hit") return `${v.hit} — ${of} ${what} for ${periodName(p.goal.period, p.from)}.${who ? "" : " Lovely work."}`;
  if (p.goal.metric === "rebooking_rate") {
    if (p.current === null) return `No checkouts yet ${periodName(p.goal.period, p.from) === "this week" ? "this week" : `in ${periodName(p.goal.period, p.from)}`}; ${v.your} rebooking goal is ${goalValue(p, p.target)}.`;
    const need = p.bestRate !== null
      ? `; even with every one of ${v.your} ${plural(p.upcomingVisits, "booked visit")} left rebooked, it would reach ${p.bestRate}% this time`
      : p.neededRebooks
      ? who
        ? `; needs ${p.neededRebooks} of ${v.your} ${plural(p.upcomingVisits, "booked visit")} left rebooked to get there`
        : `; rebook ${p.neededRebooks} of your ${plural(p.upcomingVisits, "booked visit")} left to get there`
      : p.status === "ahead" && !who
        ? "; keep offering the next visit at checkout"
        : "";
    return `${status[p.status]} — ${p.current}% rebooked against ${v.your} ${p.target}% goal${need}.`;
  }
  if (p.goal.metric === "average_ticket") {
    if (p.current === null) return `No tickets yet; ${v.your} average ticket goal is ${goalValue(p, p.target)}.`;
    const need = p.neededAverage ? `; ${v.your} ${plural(p.upcomingVisits, "booked visit")} left need to average ${whole(p.neededAverage)}` : "";
    return `${status[p.status]} — ${goalValue(p, p.current)} average ticket against ${v.your} ${goalValue(p, p.target)} goal${need}.`;
  }
  if (p.goal.metric === "new_clients") {
    const per = p.perDay !== null && p.remaining > 0 && p.daysLeft ? `; ${v.need} ${p.remaining} more` : "";
    const booked = p.bookedAhead ? ` and ${v.have} ${plural(p.bookedAhead, "new client")} already booked` : "";
    return `${status[p.status]} — ${of} new clients ${left}${per}${booked}.`;
  }
  const per = p.perDay ? `; ${v.need} ${exact(p.perDay)}/day` : "";
  const booked = p.bookedAhead ? ` and ${v.have} ${whole(p.bookedAhead)} already booked` : "";
  return `${status[p.status]} — ${of} ${left}${per}${booked}.`;
}

// A celebration the first time a milestone is reached.
export function celebration(p: Pacing): string | null {
  const what = `${metricInfo(p.goal.metric).label.toLowerCase()} goal for ${periodName(p.goal.period, p.from)}`;
  if (p.milestone === 100) return `You hit your ${what}. Well done.`;
  if (p.milestone === 75) return `Three quarters of the way to your ${what}.`;
  if (p.milestone === 50) return `Halfway to your ${what}.`;
  return null;
}

export type ActionFacts = {
  // First names, most overdue first.
  overdue: { name: string; reason: string }[];
  overdueTotal: number;
  gaps: { date: LocalDate; start: number; end: number; dayLabel: string }[];
  // Clients booked with them soon who usually buy retail.
  retailClients: { name: string; dayLabel: string }[];
  // Visits still booked in the period (for rebooking).
  upcomingVisits: number;
};

// Up to three things to do, for goals that aren't hit yet.
export function goalActions(pacings: readonly Pacing[], facts: ActionFacts): string[] {
  const open = pacings.filter((p) => p.status !== "hit");
  const wants = (...metrics: Pacing["goal"]["metric"][]) => open.some((p) => metrics.includes(p.goal.metric) && (p.status === "behind" || p.status === "on_pace"));
  const out: string[] = [];
  if (wants("service_revenue", "new_clients", "average_ticket") && facts.gaps.length) {
    const g = facts.gaps[0];
    out.push(`You have ${plural(Math.round((g.end - g.start) / 60) || 1, "hour")} open ${g.dayLabel} from ${formatMinute(g.start)} to ${formatMinute(g.end)}${facts.gaps.length > 1 ? `, and ${plural(facts.gaps.length - 1, "more gap")} after` : ""}: worth offering to the waitlist or a regular.`);
  }
  if (wants("service_revenue", "rebooking_rate") && facts.overdue.length) {
    const names = facts.overdue.slice(0, 3).map((o) => o.name);
    out.push(`${names.join(", ").replace(/, ([^,]*)$/, " and $1")} ${names.length === 1 ? "is" : "are"} due back with nothing booked${facts.overdueTotal > names.length ? ` (${facts.overdueTotal} regulars in all)` : ""}: a quick text could fill your book.`);
  }
  if (wants("retail_revenue", "average_ticket") && facts.retailClients.length) {
    const c = facts.retailClients.slice(0, 3);
    out.push(`${c.map((x) => `${x.name} (${x.dayLabel})`).join(", ").replace(/, ([^,]*)$/, " and $1")} usually ${c.length === 1 ? "buys" : "buy"} retail: have their products ready.`);
  }
  if (wants("rebooking_rate") && facts.upcomingVisits) {
    out.push(`Offer the next visit before checkout to each of your ${plural(facts.upcomingVisits, "client")} still booked.`);
  }
  return out.slice(0, 3);
}
