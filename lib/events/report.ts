// The bridal and events report (pure): for a period, the value of events
// held by month (booked or completed, by the event's date), the average
// event, how many inquiries became bookings, and deposits collected and
// still outstanding. Owners and managers (reports).

import type { EventStatus } from "./types.ts";

export type ReportEvent = {
  id: string;
  status: EventStatus;
  date: string;
  // When it came in, and when it was booked (null: never), as local dates.
  createdOn: string;
  bookedOn: string | null;
  totalCents: number;
  depositCents: number;
  payments: { kind: string; status: string; amountCents: number; paidOn: string | null }[];
};

export type EventReport = {
  // Each month with events held in the period, by the event's date.
  months: { month: string; events: number; valueCents: number; collectedCents: number }[];
  held: number;
  valueCents: number;
  averageCents: number | null;
  // Inquiries that came in during the period, and how many of them are booked.
  inquiries: number;
  booked: number;
  bookedRate: number | null;
  depositsCollectedCents: number;
  // Proposals out, waiting on the deposit to book.
  depositsOutstandingCents: number;
  depositsOutstanding: number;
  // Payments still to come on booked events (scheduled or failed).
  stillToCollectCents: number;
};

const held = (s: EventStatus) => s === "booked" || s === "trial_done" || s === "completed";
const inRange = (d: string | null, from: string, to: string) => d !== null && d >= from && d <= to;

export function eventReport(events: readonly ReportEvent[], from: string, to: string): EventReport {
  const heldInPeriod = events.filter((e) => held(e.status) && inRange(e.date, from, to));
  const months = new Map<string, EventReport["months"][number]>();
  for (const e of heldInPeriod) {
    const key = e.date.slice(0, 7);
    const m = months.get(key) ?? { month: key, events: 0, valueCents: 0, collectedCents: 0 };
    m.events += 1;
    m.valueCents += e.totalCents;
    m.collectedCents += e.payments.filter((p) => p.status === "paid").reduce((n, p) => n + p.amountCents, 0);
    months.set(key, m);
  }
  const valueCents = heldInPeriod.reduce((n, e) => n + e.totalCents, 0);
  const came = events.filter((e) => inRange(e.createdOn, from, to));
  const booked = came.filter((e) => e.bookedOn !== null).length;
  const waiting = events.filter((e) => e.status === "proposal_sent");
  return {
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    held: heldInPeriod.length,
    valueCents,
    averageCents: heldInPeriod.length ? Math.round(valueCents / heldInPeriod.length) : null,
    inquiries: came.length,
    booked,
    bookedRate: came.length ? booked / came.length : null,
    depositsCollectedCents: events.flatMap((e) => e.payments).filter((p) => p.kind === "deposit" && p.status === "paid" && inRange(p.paidOn, from, to)).reduce((n, p) => n + p.amountCents, 0),
    depositsOutstandingCents: waiting.reduce((n, e) => n + e.depositCents, 0),
    depositsOutstanding: waiting.length,
    stillToCollectCents: events
      .filter((e) => e.status === "booked" || e.status === "trial_done")
      .flatMap((e) => e.payments)
      .filter((p) => p.status === "scheduled" || p.status === "failed")
      .reduce((n, p) => n + p.amountCents, 0),
  };
}
