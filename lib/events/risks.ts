// What could go wrong with the events coming up (pure): Denise's staffing
// checks and the brief's event risks. A balance still unpaid a week out, a
// trial not booked a month out, the headcount cutoff closing or just past,
// someone on the team off or busy then (time off, clients, another event:
// the booking rules, eventClashes), and artists not chosen yet. Every fact
// comes from our data; the wording is ours.

import { addDays, daysBetween, type LocalDate } from "../scheduling/time.ts";
import type { EventStatus } from "./types.ts";

export const BALANCE_DAYS = 7;
export const TRIAL_DAYS = 30;
// How long before the cutoff we say it's closing, and after it that it's passed.
export const CUTOFF_AHEAD_DAYS = 3;
export const CUTOFF_AFTER_DAYS = 2;
// Events this far ahead are checked.
export const RISK_WINDOW_DAYS = 60;

export type RiskEvent = {
  id: string;
  // The event's name, as staff gave it.
  name: string;
  date: LocalDate;
  status: EventStatus;
  // Scheduled or failed payments still to come.
  unpaidCents: number;
  failedPayment: boolean;
  // The salon has a trial service and none is booked for this event.
  trialMissing: boolean;
  cutoff: LocalDate;
  openLanes: number;
  // Team members who aren't free for their time on the event, and why
  // ("has time off": CLASH_TEXT).
  busyTeam: { staffId: string; name: string; timeOff: boolean; text: string }[];
};

export type EventRiskKind = "balance_unpaid" | "trial_not_booked" | "headcount_cutoff" | "time_off" | "team_busy" | "unstaffed";
export type EventRisk = { key: string; eventId: string; kind: EventRiskKind; title: string; detail: string };

const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const dayName = (d: LocalDate) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export function eventRisks(events: RiskEvent[], today: LocalDate): EventRisk[] {
  const risks: EventRisk[] = [];
  for (const e of events) {
    if (e.status !== "booked" && e.status !== "trial_done") continue;
    const away = daysBetween(today, e.date);
    if (away < 0 || away > RISK_WINDOW_DAYS) continue;
    const add = (kind: EventRiskKind, detail: string, part = "") => risks.push({ key: `event:${kind}:${e.id}${part && `:${part}`}`, eventId: e.id, kind, title: `${e.name} ${inDays(away)}`, detail });

    // No amounts: the brief is the front desk's too, which sees no money on
    // the Dashboard. The event page has them.
    if (e.failedPayment) add("balance_unpaid", "A payment didn't go through. Try the card again, or send a card link.");
    else if (e.unpaidCents > 0 && away <= BALANCE_DAYS) add("balance_unpaid", "There's still a balance to collect.");
    if (e.trialMissing && e.status === "booked" && away <= TRIAL_DAYS) add("trial_not_booked", "The trial isn't booked yet.");
    const toCutoff = daysBetween(today, e.cutoff);
    if (toCutoff >= 0 && toCutoff <= CUTOFF_AHEAD_DAYS) add("headcount_cutoff", `Party changes close ${toCutoff === 0 ? "today" : dayName(e.cutoff)}. Confirm the headcount.`);
    else if (toCutoff < 0 && -toCutoff <= CUTOFF_AFTER_DAYS) add("headcount_cutoff", "The headcount cutoff has passed. Party changes now need a manager.");
    for (const b of e.busyTeam) add(b.timeOff ? "time_off" : "team_busy", `${b.name} ${b.text} then. Choose someone else.`, b.staffId);
    if (e.openLanes > 0) add("unstaffed", e.openLanes === 1 ? "One artist isn't chosen yet." : `${e.openLanes} artists aren't chosen yet.`);
  }
  // The soonest first; within an event, in the order above.
  const order = new Map(events.map((e) => [e.id, e.date]));
  return risks.sort((a, b) => order.get(a.eventId)!.localeCompare(order.get(b.eventId)!));
}

// The last day an event's risks are looked for, from today.
export const riskHorizon = (today: LocalDate) => addDays(today, RISK_WINDOW_DAYS);
