// A stylist's live earnings on My day (pure, unit-tested): what each sale
// today paid them, an estimate for visits not checked out yet (final at
// checkout), and running totals for today, the week and the pay period.
// Every figure comes from payroll's own priced tickets (./payroll.ts
// payLine, ./commission.ts), so My day and Payroll always agree.

import { payLines, tieredCommission, effectiveTiers, type Basis, type PlanRules } from "./commission.ts";
import type { Ticket } from "./payroll.ts";
import type { LocalDate } from "./scheduling/time.ts";

export type Totals = { salesCents: number; feeCents: number; commissionCents: number; tipCents: number; earnedCents: number };

// What tickets between two dates (inclusive) paid: unrounded per line,
// rounded once, like payroll.
export function totalsBetween(tickets: readonly Ticket[], from: LocalDate, to: LocalDate, dayOf: (iso: string) => LocalDate): Totals {
  let sales = 0;
  let fee = 0;
  let commission = 0;
  let tips = 0;
  for (const t of tickets) {
    const day = dayOf(t.at);
    if (day < from || day > to) continue;
    tips += t.tipCents;
    for (const l of t.lines) {
      sales += l.cents;
      fee += l.pay?.feeCents ?? 0;
      commission += l.pay?.commissionCents ?? (l.cents * l.pct) / 100;
    }
  }
  const c = Math.round(commission);
  return { salesCents: sales, feeCents: Math.round(fee), commissionCents: c, tipCents: tips, earnedCents: c + tips };
}

// What counts toward a tier window so far (plan lines only, as payLines counts).
export function windowBasis(
  tickets: readonly Ticket[],
  rulesFor: (versionId: string) => PlanRules | null,
  windowOf: (at: string, rules: PlanRules) => string,
  window: string,
): Basis {
  const basis: Basis = { service: 0, product: 0 };
  for (const t of tickets) {
    for (const l of t.lines) {
      const rules = l.versionId ? rulesFor(l.versionId) : null;
      if (rules && windowOf(t.at, rules) === window) basis[l.kind] += l.cents;
    }
  }
  return basis;
}

export type EstimateIn = { itemId: string; service: string; client: string; priceCents: number };
export type Estimate = EstimateIn & { feeCents: number; commissionCents: number };

// Visits checked in but not checked out: their booked prices, paid on
// their current plan after what's already sold in the window (so a tier
// they'd cross counts), or at their own service rate. Rounded per visit;
// the real figure comes at checkout.
export function estimates(
  items: readonly EstimateIn[],
  pay: { rules: PlanRules; basis: Basis; at: string } | { ownPct: number },
): Estimate[] {
  if ("ownPct" in pay) return items.map((i) => ({ ...i, feeCents: 0, commissionCents: Math.round((i.priceCents * pay.ownPct) / 100) }));
  const lines = items.map((i) => ({ at: pay.at, kind: "service" as const, cents: i.priceCents, soldCents: i.priceCents, quantity: 1, pct: 0, versionId: "current" }));
  const paid = payLines(lines, () => pay.rules, () => "now", () => ({ ...pay.basis }));
  return items.map((i, n) => ({ ...i, feeCents: Math.round(paid[n].feeCents), commissionCents: Math.round(paid[n].commissionCents) }));
}

// The rate their next service dollar earns now.
export function currentRate(rules: PlanRules, basis: Basis): number {
  const tiers = effectiveTiers(rules, "service");
  return Math.round((tieredCommission(tiers, basis.service + 100) - tieredCommission(tiers, basis.service)) * 100) / 100;
}
