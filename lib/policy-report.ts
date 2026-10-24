// The policy page's numbers (pure, unit-tested): fees charged, waived and
// failed in the period, what the policy recovered, repeat offenders, and
// how many upcoming bookings have a card on file. Every number comes from
// here, never from Denise.

import { countsAsStrike } from "./policy.ts";

export type ReportFee = {
  id: string;
  kind: "late_cancel" | "no_show";
  feeCents: number;
  fromDepositCents: number;
  status: string;
  createdAt: string;
  clientId: string;
  clientName: string;
};

export type Tally = { count: number; cents: number };

export type PolicySummary = {
  charged: Tally;
  waived: Tally;
  failed: Tally;
  // Waiting for the grace to pass, or for a card.
  waiting: Tally;
  // Charged (deposits kept included); waived ones were refunded.
  recoveredCents: number;
  lateCancels: number;
  noShows: number;
};

const add = (t: Tally, cents: number) => ({ count: t.count + 1, cents: t.cents + cents });

export function policySummary(fees: readonly ReportFee[]): PolicySummary {
  const zero = { count: 0, cents: 0 };
  const s: PolicySummary = { charged: zero, waived: zero, failed: zero, waiting: zero, recoveredCents: 0, lateCancels: 0, noShows: 0 };
  for (const f of fees) {
    if (f.status === "voided") continue;
    if (f.kind === "late_cancel") s.lateCancels += 1;
    else s.noShows += 1;
    if (f.status === "charged") s.charged = add(s.charged, f.feeCents);
    else if (f.status === "waived") s.waived = add(s.waived, f.feeCents);
    else if (f.status === "failed") s.failed = add(s.failed, f.feeCents);
    else if (f.status === "pending" || f.status === "no_card") s.waiting = add(s.waiting, f.feeCents);
  }
  s.recoveredCents = s.charged.cents;
  return s;
}

export type Offender = { clientId: string; clientName: string; strikes: number; lastAt: string };

// Clients with at least `count` strikes among these (the last `months`
// already), most first.
export function repeatOffenders(fees: readonly ReportFee[], count: number): Offender[] {
  const by = new Map<string, Offender>();
  for (const f of fees) {
    if (!countsAsStrike(f)) continue;
    const o = by.get(f.clientId) ?? { clientId: f.clientId, clientName: f.clientName, strikes: 0, lastAt: f.createdAt };
    o.strikes += 1;
    if (f.createdAt > o.lastAt) o.lastAt = f.createdAt;
    by.set(f.clientId, o);
  }
  return [...by.values()].filter((o) => o.strikes >= count).sort((a, b) => b.strikes - a.strikes || b.lastAt.localeCompare(a.lastAt));
}

// Of the upcoming bookings, how many have a card on file.
export function cardShare(visits: readonly { clientId: string | null }[], withCard: ReadonlySet<string>): { withCard: number; total: number; percent: number } {
  const total = visits.length;
  const covered = visits.filter((v) => v.clientId && withCard.has(v.clientId)).length;
  return { withCard: covered, total, percent: total ? Math.round((covered / total) * 100) : 0 };
}
