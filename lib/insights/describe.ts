// Plain-English wording for what Denise has learned, from the stored facts
// (no AI): the client insight card, "usually takes" lines. Pure.

import type { ClientInsight } from "./clients.ts";
import type { DurationInsight } from "./durations.ts";

const WEEKDAYS = ["", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const TIMES = { morning: "mornings", afternoon: "afternoons", evening: "evenings" } as const;
const DAY = 86_400_000;

export type ClientSpend = { lifetimeSpendCents: number; averageVisitCents: number | null; retailRate: number | null };

// "2h 40m", "45m".
export function minutesText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function every(days: number): string {
  return days < 14 ? `every ~${days} days` : `every ~${Math.round(days / 7)} weeks`;
}

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const pct = (rate: number) => `${Math.round(rate * 100)}%`;

// One sentence, a short line for booking details ("Every ~4 weeks with
// Gil · slightly overdue") and a few short tags. Spend only when it's given
// (front of house); stylists don't see it.
export function describeClient(
  c: ClientInsight,
  spend: ClientSpend | null,
  names: { staff: (id: string) => string | null; dayOf: (iso: string) => string },
  asOf: Date,
): { summary: string; line: string; tags: { label: string; tone: "neutral" | "good" | "warn" }[] } {
  if (c.visits === 0) return { summary: "New client: no visits yet.", line: "New client", tags: [] };

  const parts: string[] = [];
  const rhythm = c.visits === 1 ? "One visit so far" : `Comes ${every(c.intervalDays ?? 42)}`;
  parts.push(rhythm);
  const when = [c.preferredWeekday ? WEEKDAYS[c.preferredWeekday] : null, c.timeOfDay ? TIMES[c.timeOfDay] : null].filter(Boolean);
  const stylist = c.preferredStaffId ? names.staff(c.preferredStaffId) : null;
  if (when.length || stylist) {
    const day = when.length === 2 ? `${when[0]!.replace(/s$/, "")} ${when[1]}` : when[0] ?? "";
    parts.push(`usually ${[day, stylist ? `with ${stylist}` : ""].filter(Boolean).join(" ")}`);
  }

  let due: string | null = null;
  if (c.due === "booked" && c.nextBooked) due = `next visit booked for ${names.dayOf(c.nextBooked)}`;
  else if (c.due === "due_soon" && c.nextDue) {
    const days = Math.max(1, Math.round((new Date(c.nextDue).getTime() - asOf.getTime()) / DAY));
    due = `due in about ${days} ${days === 1 ? "day" : "days"}`;
  }
  else if (c.due === "overdue") due = c.overdueDays <= 7 ? "slightly overdue" : `${Math.round(c.overdueDays / 7)} weeks overdue`;
  else if (c.due === "lapsed" && c.lastVisit) due = `hasn't been in for ${Math.round((asOf.getTime() - new Date(c.lastVisit).getTime()) / (7 * DAY))} weeks`;
  if (due) parts.push(due);
  const head = `${c.visits === 1 ? rhythm : rhythm.replace(/^Comes every/, "Every")}${stylist ? ` with ${stylist}` : ""}`;
  const line = [head, due].filter(Boolean).join(" · ");

  if (spend?.retailRate !== null && spend?.retailRate !== undefined) {
    if (spend.retailRate >= 0.5) parts.push("often buys retail");
    else if (spend.retailRate < 0.15) parts.push("rarely buys retail");
  }

  const tags: { label: string; tone: "neutral" | "good" | "warn" }[] = [];
  if (c.churnRisk === "high") tags.push({ label: "Visits getting further apart", tone: "warn" });
  if (c.lateRate !== null && c.lateRate >= 0.3) tags.push({ label: `Late ${pct(c.lateRate)} of visits`, tone: "warn" });
  if (c.noShowRate !== null && c.noShowRate >= 0.15) tags.push({ label: `No-show ${pct(c.noShowRate)}`, tone: "warn" });
  if (c.cancelRate !== null && c.cancelRate >= 0.25) tags.push({ label: `Cancels ${pct(c.cancelRate)}`, tone: "warn" });
  if (spend) tags.push({ label: `${money(spend.lifetimeSpendCents)} over ${c.visits} ${c.visits === 1 ? "visit" : "visits"}`, tone: "neutral" });

  const sentence = parts.join(", ");
  return { summary: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`, line, tags };
}

// "Bridget usually takes 3h 1m for this (9 visits)."
export function usualTime(name: string, d: Pick<DurationInsight, "medianMinutes" | "visits">): string {
  return `${name} usually takes ${minutesText(d.medianMinutes)} for this (${d.visits} visits)`;
}
