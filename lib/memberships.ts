// Memberships (pure, unit-tested; they run under plain Node for the billing
// job, so relative .ts imports): billing periods, when one can end, what a
// plan includes, member prices at checkout, and the owners' numbers
// (members, monthly recurring revenue, churn).

import { addDays, type LocalDate } from "./scheduling/time.ts";

export type IntervalUnit = "week" | "month";
export type MembershipStatus = "active" | "past_due" | "paused" | "canceled";

export const STATUS_LABELS: Record<MembershipStatus, string> = { active: "Active", past_due: "Payment failed", paused: "Paused", canceled: "Ended" };

// After a failed payment, the next tries are this many days apart; the
// fourth failure ends the membership (record_membership_charge).
export const RETRY_DAYS = [1, 3, 4] as const;

// A date n intervals on, as Postgres adds them (private.add_interval):
// months clamp to the month's end, so Jan 31 + 1 month is Feb 28.
export function addInterval(date: LocalDate, unit: IntervalUnit, count: number): LocalDate {
  if (unit === "week") return addDays(date, 7 * count);
  const [y, m, d] = date.split("-").map(Number);
  const months = y * 12 + (m - 1) + count;
  const year = Math.floor(months / 12);
  const month = (months % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// "$89 a month", "$25 every 2 weeks", "$900 a year".
export function priceText(cents: number, unit: IntervalUnit, count: number): string {
  const price = cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toFixed(2)}`;
  if (unit === "month" && count === 12) return `${price} a year`;
  if (count === 1) return `${price} a ${unit}`;
  return `${price} every ${count} ${unit}s`;
}

export const periodName = (unit: IntervalUnit, count: number) => (unit === "month" && count === 12 ? "year" : count === 1 ? unit : `${count} ${unit}s`);

export type MembershipTerms = {
  startedOn: LocalDate;
  anchorOn: LocalDate;
  periodsPaid: number;
  currentPeriodEnd: LocalDate;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  minTermPeriods: number;
  cancelNoticeDays: number;
};

// The earliest a membership can end if they ask today: the end of a
// period, after the minimum term and the notice (as
// private.membership_earliest_end).
export function earliestEnd(m: MembershipTerms, today: LocalDate): LocalDate {
  const floor = [m.currentPeriodEnd, addInterval(m.startedOn, m.intervalUnit, m.intervalCount * m.minTermPeriods), addDays(today, m.cancelNoticeDays)].sort().at(-1)!;
  let end = m.currentPeriodEnd;
  for (let n = m.periodsPaid; end < floor; ) {
    n += 1;
    end = addInterval(m.anchorOn, m.intervalUnit, m.intervalCount * n);
  }
  return end;
}

// Plan terms in words, for the plan list and the checkout.
export function benefitsText(plan: { services: { name: string; quantity: number; rollover: boolean }[]; serviceDiscountPct: number; retailDiscountPct: number; intervalUnit: IntervalUnit; intervalCount: number }): string {
  const per = periodName(plan.intervalUnit, plan.intervalCount);
  const parts = plan.services.map((s) => `${s.quantity} ${s.name}${s.quantity === 1 ? "" : "s"} a ${per}${s.rollover ? " (unused roll over)" : ""}`);
  if (plan.serviceDiscountPct) parts.push(`${plan.serviceDiscountPct}% off services`);
  if (plan.retailDiscountPct) parts.push(`${plan.retailDiscountPct}% off retail`);
  return parts.join(", ") || "No benefits set";
}

// Member prices at checkout: the best of the client's active memberships.
export type MemberPrices = { name: string; servicePct: number; retailPct: number };

export function memberPrices(memberships: readonly { status: MembershipStatus; name: string; serviceDiscountPct: number; retailDiscountPct: number }[]): MemberPrices | null {
  const active = memberships.filter((m) => m.status === "active");
  if (!active.length) return null;
  const best = [...active].sort((a, b) => b.serviceDiscountPct + b.retailDiscountPct - (a.serviceDiscountPct + a.retailDiscountPct))[0];
  return { name: best.name, servicePct: Math.max(...active.map((m) => m.serviceDiscountPct)), retailPct: Math.max(...active.map((m) => m.retailDiscountPct)) };
}

// What a member price takes off a line (rounded as complete_sale does).
export const memberDiscountCents = (grossCents: number, pct: number) => Math.round((grossCents * pct) / 100);

// Monthly recurring revenue: each membership's price as a monthly amount.
export function monthlyCents(m: { priceCents: number; intervalUnit: IntervalUnit; intervalCount: number }): number {
  return m.intervalUnit === "month" ? m.priceCents / m.intervalCount : (m.priceCents * 52) / 12 / m.intervalCount;
}

export type MembershipRow = {
  status: MembershipStatus;
  planId: string | null;
  name: string;
  priceCents: number;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  startedOn: LocalDate;
  // Local date it ended, if it has.
  endedOn: LocalDate | null;
  // Voided at sale: never really started.
  voided: boolean;
};

// The owners' numbers for a period (inclusive dates): members now (active,
// past due or paused), what's billed monthly (active and past due), and
// churn: of the members at the start, how many ended during it.
export function membershipReport(rows: readonly MembershipRow[], from: LocalDate, to: LocalDate) {
  const real = rows.filter((r) => !r.voided);
  const live = real.filter((r) => r.status !== "canceled");
  const billing = live.filter((r) => r.status === "active" || r.status === "past_due");
  const atStart = real.filter((r) => r.startedOn < from && (r.endedOn === null || r.endedOn >= from));
  const churned = atStart.filter((r) => r.endedOn !== null && r.endedOn <= to);
  const joined = real.filter((r) => r.startedOn >= from && r.startedOn <= to);
  const byPlan = new Map<string, { name: string; members: number; mrrCents: number }>();
  for (const r of live) {
    const key = r.planId ?? r.name;
    const p = byPlan.get(key) ?? { name: r.name, members: 0, mrrCents: 0 };
    p.members += 1;
    if (r.status !== "paused") p.mrrCents += monthlyCents(r);
    byPlan.set(key, p);
  }
  return {
    members: live.length,
    pastDue: live.filter((r) => r.status === "past_due").length,
    paused: live.filter((r) => r.status === "paused").length,
    mrrCents: Math.round(billing.reduce((n, r) => n + monthlyCents(r), 0)),
    joined: joined.length,
    churned: churned.length,
    startingMembers: atStart.length,
    churnPercent: atStart.length ? Math.round((churned.length / atStart.length) * 1000) / 10 : null,
    plans: [...byPlan.values()].map((p) => ({ ...p, mrrCents: Math.round(p.mrrCents) })).sort((a, b) => b.members - a.members),
  };
}

// A history line in words ("Renewed ($89)").
export const historyText = (e: { kind: string; detail: string | null; service?: string | null }, money?: string): string => {
  switch (e.kind) {
    case "started":
      return `Joined${money ? ` (${money})` : ""}`;
    case "renewed":
      return `Renewed${money ? ` (${money})` : ""}`;
    case "payment_failed":
      return `Payment failed: ${e.detail ?? "no reason given"}`;
    case "pause_scheduled":
      return `Pause set: ${e.detail ?? ""}`;
    case "paused":
      return `Paused ${e.detail ? e.detail.toLowerCase() : ""}`.trim();
    case "resumed":
      return "Resumed";
    case "cancel_requested":
      return `Asked to end: ${e.detail ?? ""}`;
    case "kept":
      return "Decided to stay";
    case "canceled":
      return `Ended: ${e.detail ?? ""}`;
    case "card_updated":
      return `Card updated${e.detail ? ` to ${e.detail}` : ""}`;
    case "credit_used":
      return `Used: ${e.service ?? "a service"}`;
    case "credit_returned":
      return `Given back: ${e.service ?? "a service"} (${e.detail ?? "voided"})`;
    case "renewal_voided":
      return `Renewal voided: ${e.detail ?? ""}`;
    default:
      return e.kind;
  }
};

// The plan form, as typed (dollars and whole numbers as text).
export type PlanForm = {
  name: string;
  description: string;
  price: string;
  intervalUnit: IntervalUnit;
  intervalCount: string;
  serviceDiscountPct: string;
  retailDiscountPct: string;
  minTermPeriods: string;
  cancelNoticeDays: string;
  allowPause: boolean;
  maxPausePeriods: string;
  isActive: boolean;
  services: { serviceId: string; quantity: string; rollover: boolean }[];
};

const whole = (text: string, min: number, max: number) => {
  const n = text.trim() === "" ? 0 : Number(text);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

// What save_membership_plan is sent, or what's wrong first.
export function parsePlanForm(f: PlanForm): { ok: true; plan: Record<string, unknown> } | { ok: false; message: string } {
  const name = f.name.trim();
  if (!name || name.length > 80) return { ok: false, message: "Give the membership a name." };
  const t = f.price.trim().replace(/^\$/, "").replace(/,/g, "");
  const price = /^\d+(\.\d{0,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
  if (!price || price < 100 || price > 100000) return { ok: false, message: "Enter a price from $1 to $1,000." };
  if (f.intervalUnit !== "week" && f.intervalUnit !== "month") return { ok: false, message: "Choose how often it's billed." };
  const count = whole(f.intervalCount, 1, 12);
  if (!count) return { ok: false, message: "Bill every 1 to 12 weeks or months." };
  const servicePct = whole(f.serviceDiscountPct, 0, 100);
  const retailPct = whole(f.retailDiscountPct, 0, 100);
  if (servicePct === null || retailPct === null) return { ok: false, message: "Member discounts are whole percents from 0 to 100." };
  const minTerm = whole(f.minTermPeriods, 0, 24);
  if (minTerm === null) return { ok: false, message: "The minimum term is 0 to 24 periods." };
  const notice = whole(f.cancelNoticeDays, 0, 90);
  if (notice === null) return { ok: false, message: "Notice is 0 to 90 days." };
  const maxPause = whole(f.maxPausePeriods || "1", 1, 6);
  if (!maxPause) return { ok: false, message: "A pause is 1 to 6 periods." };
  const services = f.services.filter((s) => s.serviceId);
  if (new Set(services.map((s) => s.serviceId)).size !== services.length) return { ok: false, message: "List each included service once." };
  const parsed = services.map((s) => ({ service_id: s.serviceId, quantity: whole(s.quantity, 1, 20), rollover: s.rollover }));
  if (parsed.some((s) => !s.quantity)) return { ok: false, message: "Include 1 to 20 of each service." };
  if (!parsed.length && !servicePct && !retailPct) return { ok: false, message: "Add an included service or a member discount." };
  return {
    ok: true,
    plan: {
      name,
      description: f.description.trim() || null,
      price_cents: price,
      interval_unit: f.intervalUnit,
      interval_count: count,
      service_discount_pct: servicePct,
      retail_discount_pct: retailPct,
      min_term_periods: minTerm,
      cancel_notice_days: notice,
      allow_pause: f.allowPause,
      max_pause_periods: maxPause,
      is_active: f.isActive,
      services: parsed,
    },
  };
}
