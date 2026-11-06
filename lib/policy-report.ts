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

// "Not charged, and why": each no-show and late cancellation in a period
// (public.policy_not_charged), grouped by why its fee wasn't collected.
export type Incident = {
  kind: "late_cancel" | "no_show";
  visitCents: number;
  feeCents: number;
  collectedCents: number;
  // null: no fee assessed (no client on the visit, or before the policy).
  status: string | null;
  waiveReason: string | null;
};

export type MissReason = "no_fee" | "no_card" | "failed" | "waiting" | "waived" | "not_assessed";

export const MISS_LABELS: Record<MissReason, string> = {
  no_fee: "The policy sets no fee",
  no_card: "No card on file",
  failed: "Card declined",
  waiting: "Waiting to be charged",
  waived: "Waived",
  not_assessed: "No fee assessed",
};

export const MISS_NOTES: Record<MissReason, string> = {
  no_fee: "No fee for this kind of visit, or a late cancellation booked inside the long-hold rule.",
  no_card: "Charged as soon as a card is added.",
  failed: "Try the card again from the fee, or ask for another card.",
  waiting: "Inside the 10 minutes to undo, or due on the next run.",
  waived: "Waived by staff, with their reason.",
  not_assessed: "No client on the visit, or before the salon had a policy.",
};

export type MissRow = { reason: MissReason; count: number; visitCents: number; uncollectedCents: number; reasons: { text: string; count: number; cents: number }[] };

export type NotCharged = {
  incidents: number;
  noShows: number;
  lateCancels: number;
  // What the visits were booked for, the fees the policy set, and what came in.
  visitCents: number;
  feeCents: number;
  collectedCents: number;
  // Booked value with nothing collected against it: the headline.
  notChargedCents: number;
  // Fees set but not (yet) collected.
  uncollectedFeeCents: number;
  rows: MissRow[];
};

const ORDER: MissReason[] = ["no_card", "failed", "waived", "waiting", "no_fee", "not_assessed"];

function reasonOf(i: Incident): MissReason | null {
  switch (i.status) {
    case null:
      return "not_assessed";
    case "charged":
      return null;
    case "none":
      return "no_fee";
    case "no_card":
      return "no_card";
    case "failed":
      return "failed";
    case "waived":
      return "waived";
    default:
      return "waiting";
  }
}

// The value of a visit not covered by what was collected; a charged fee
// smaller than the visit isn't counted as missed (the policy chose it).
export function notCharged(incidents: readonly Incident[], topWaiveReasons = 5): NotCharged {
  const r: NotCharged = { incidents: 0, noShows: 0, lateCancels: 0, visitCents: 0, feeCents: 0, collectedCents: 0, notChargedCents: 0, uncollectedFeeCents: 0, rows: [] };
  const by = new Map<MissReason, MissRow & { texts: Map<string, { count: number; cents: number }> }>();
  for (const i of incidents) {
    r.incidents += 1;
    if (i.kind === "no_show") r.noShows += 1;
    else r.lateCancels += 1;
    r.visitCents += i.visitCents;
    r.feeCents += i.feeCents;
    r.collectedCents += i.collectedCents;
    const reason = reasonOf(i);
    if (!reason) continue;
    const missed = Math.max(0, i.visitCents - i.collectedCents);
    r.notChargedCents += missed;
    r.uncollectedFeeCents += Math.max(0, i.feeCents - i.collectedCents);
    const row = by.get(reason) ?? { reason, count: 0, visitCents: 0, uncollectedCents: 0, reasons: [], texts: new Map() };
    row.count += 1;
    row.visitCents += missed;
    row.uncollectedCents += Math.max(0, i.feeCents - i.collectedCents);
    if (reason === "waived") {
      const text = i.waiveReason?.trim() || "No reason given";
      const t = row.texts.get(text) ?? { count: 0, cents: 0 };
      row.texts.set(text, { count: t.count + 1, cents: t.cents + missed });
    }
    by.set(reason, row);
  }
  r.rows = ORDER.filter((k) => by.has(k)).map((k) => {
    const { texts, ...row } = by.get(k)!;
    const sorted = [...texts.entries()].map(([text, t]) => ({ text, ...t })).sort((a, b) => b.cents - a.cents || b.count - a.count || a.text.localeCompare(b.text));
    const top = sorted.slice(0, topWaiveReasons);
    const rest = sorted.slice(topWaiveReasons);
    if (rest.length) top.push({ text: "Other reasons", count: rest.reduce((n, t) => n + t.count, 0), cents: rest.reduce((n, t) => n + t.cents, 0) });
    return { ...row, reasons: top };
  });
  return r;
}

// Any period up to a year and up to today, this month by default (local
// dates, `to` included).
export function parseMissRange(params: { from?: unknown; to?: unknown }, today: string): { from: string; to: string } {
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);
  let from = date(params.from) ?? `${today.slice(0, 8)}01`;
  let to = date(params.to) ?? today;
  if (from > today) from = today;
  if (to > today) to = today;
  if (to < from) [from, to] = [to, from];
  const max = new Date(Date.parse(`${from}T00:00:00Z`) + 365 * 86_400_000).toISOString().slice(0, 10);
  if (to > max) to = max;
  return { from, to };
}
