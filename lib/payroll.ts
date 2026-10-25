// Payroll and commission (pure, unit-tested): pay periods, each sale's
// effect on a staff member's pay, and the totals for a period.
//
// A sale counts in the period it was completed. A refund counts in the
// period it was given, taking back the same share of every line and tip
// (a $30 refund on a $120 sale takes back a quarter of each). A void counts
// in the period it was voided, taking back whatever was left. So a sale
// paid in one period and refunded in the next is paid, then clawed back,
// and nothing is ever paid twice. Commission is worked out on the period's
// lines, ex tax and after discounts, at the rate recorded on each line when
// the sale was made (a refund or void takes back at the same rate), or by
// the plan version it was sold under (./commission.ts: tiers, back-bar
// fees, booth rent); hourly pay at the rate in effect each day. Changing a
// rate or a plan never changes past pay.

import { monthStart, payLines, rentFor, type Basis, type LinePay, type PayInput, type PlanRules } from "./commission.ts";
import { csvTable, dollars } from "./csv.ts";
import { averageTipPct } from "./tips.ts";
import { mergeIntervals, subtractIntervals } from "./scheduling/intervals.ts";
import type { StaffSchedule } from "./scheduling/availability.ts";
import { addDays, datesBetween, weekdayOf, type LocalDate } from "./scheduling/time.ts";

export type PayPeriodKind = "weekly" | "biweekly" | "semi_monthly" | "custom";

export const PAY_PERIOD_LABELS: Record<PayPeriodKind, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  semi_monthly: "Twice a month (1st–15th, 16th–end)",
  custom: "Custom (pick the dates each time)",
};

// From and to are inclusive local dates.
export type PayPeriod = { from: LocalDate; to: LocalDate };

const daysBetween = (a: LocalDate, b: LocalDate) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function lastOfMonth(date: LocalDate): LocalDate {
  const [y, m] = date.split("-").map(Number);
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
}

// The pay period a date falls in. Custom salons pick their own dates; the
// calendar month is where the picker starts.
export function periodContaining(kind: PayPeriodKind, anchor: LocalDate, date: LocalDate): PayPeriod {
  if (kind === "weekly" || kind === "biweekly") {
    const length = kind === "weekly" ? 7 : 14;
    const offset = Math.floor(daysBetween(anchor, date) / length) * length;
    const from = addDays(anchor, offset);
    return { from, to: addDays(from, length - 1) };
  }
  const month = date.slice(0, 8);
  if (kind === "semi_monthly") return Number(date.slice(8)) <= 15 ? { from: `${month}01`, to: `${month}15` } : { from: `${month}16`, to: lastOfMonth(date) };
  return { from: `${month}01`, to: lastOfMonth(date) };
}

export const previousPeriod = (kind: PayPeriodKind, anchor: LocalDate, p: PayPeriod) => periodContaining(kind, anchor, addDays(p.from, -1));
export const nextPeriod = (kind: PayPeriodKind, anchor: LocalDate, p: PayPeriod) => periodContaining(kind, anchor, addDays(p.to, 1));

// The period payroll is usually run for: the last one that's over.
export const lastCompletedPeriod = (kind: PayPeriodKind, anchor: LocalDate, today: LocalDate) => previousPeriod(kind, anchor, periodContaining(kind, anchor, today));

// What payroll_sales returns: a sale with only the lines and tips that
// count for pay (service and product lines with a stylist).
export type PayrollSale = {
  id: string;
  number: number;
  created_at: string;
  total_cents: number;
  voided_at: string | null;
  client: string | null;
  // commission_pct: the rate recorded on the line when it was sold.
  // commission_version_id: the plan version it was sold under, if any.
  lines: { kind: "service" | "product"; staff_id: string; description: string; quantity: number; net_cents: number; commission_pct: number; commission_version_id?: string | null }[];
  tips: { staff_id: string; amount_cents: number }[];
  // The tenders that took money (card, cash, gift card), for itemized tips.
  payments?: { method: "card" | "cash" | "gift_card"; online: boolean }[];
  refunds: { amount_cents: number; at: string }[];
};

export type TicketKind = "sale" | "refund" | "void";

// One sale's effect on one person's pay in the period.
export type Ticket = {
  saleId: string;
  number: number;
  at: string;
  kind: TicketKind;
  client: string | null;
  // How the sale was paid: "Card", "Cash + Gift card", "Card online".
  paidWith: string | null;
  serviceCents: number;
  retailCents: number;
  tipCents: number;
  // soldCents: what the whole line sold for (to share a back-bar fee);
  // pay: what it earned, once a pay line has worked it out.
  lines: { description: string; kind: "service" | "product"; quantity: number; cents: number; pct: number; versionId: string | null; soldCents: number; pay?: LinePay }[];
};

const PAID_WITH = { card: "Card", card_online: "Card online", cash: "Cash", gift_card: "Gift card" } as const;

export function paidWith(payments: PayrollSale["payments"]): string | null {
  const kinds = new Set((payments ?? []).map((p) => (p.method === "card" && p.online ? "card_online" : p.method)));
  const order = ["card", "card_online", "cash", "gift_card"] as const;
  return order.filter((k) => kinds.has(k)).map((k) => PAID_WITH[k]).join(" + ") || null;
}

type Amounts = { serviceCents: number; retailCents: number; tipCents: number; lines: Ticket["lines"] };

function ownShare(sale: PayrollSale, staffId: string): Amounts {
  const lines = sale.lines.filter((l) => l.staff_id === staffId).map((l) => ({
      description: l.description,
      kind: l.kind,
      quantity: l.quantity,
      cents: l.net_cents,
      pct: Number(l.commission_pct),
      versionId: l.commission_version_id ?? null,
      soldCents: l.net_cents,
    }));
  return {
    serviceCents: lines.filter((l) => l.kind === "service").reduce((n, l) => n + l.cents, 0),
    retailCents: lines.filter((l) => l.kind === "product").reduce((n, l) => n + l.cents, 0),
    tipCents: sale.tips.filter((t) => t.staff_id === staffId).reduce((n, t) => n + t.amount_cents, 0),
    lines,
  };
}

// Taking back a share (0 to 1) of each line and tip, rounded per line.
function takeBack(a: Amounts, share: number): Amounts {
  const lines = a.lines.map((l) => ({ ...l, cents: -Math.round(l.cents * share) }));
  return {
    serviceCents: lines.filter((l) => l.kind === "service").reduce((n, l) => n + l.cents, 0),
    retailCents: lines.filter((l) => l.kind === "product").reduce((n, l) => n + l.cents, 0),
    tipCents: -Math.round(a.tipCents * share),
    lines,
  };
}

const minus = (a: Amounts, b: Amounts): Amounts => ({
  serviceCents: a.serviceCents - b.serviceCents,
  retailCents: a.retailCents - b.retailCents,
  tipCents: a.tipCents - b.tipCents,
  lines: a.lines.map((l, i) => ({ ...l, cents: l.cents - (b.lines[i]?.cents ?? 0) })),
});

const plus = (a: Amounts, b: Amounts): Amounts => minus(a, { ...b, serviceCents: -b.serviceCents, retailCents: -b.retailCents, tipCents: -b.tipCents, lines: b.lines.map((l) => ({ ...l, cents: -l.cents })) });

// Every ticket behind one person's pay between two instants: the sales,
// refunds and voids that fall in it.
export function ticketsFor(sales: readonly PayrollSale[], staffId: string, from: Date, to: Date): Ticket[] {
  const within = (iso: string) => {
    const t = Date.parse(iso);
    return t >= from.getTime() && t < to.getTime();
  };
  const out: Ticket[] = [];
  for (const sale of sales) {
    const own = ownShare(sale, staffId);
    if (own.lines.length === 0 && own.tipCents === 0) continue;
    const base = { saleId: sale.id, number: sale.number, client: sale.client, paidWith: paidWith(sale.payments) };
    const push = (kind: TicketKind, at: string, a: Amounts) => out.push({ ...base, kind, at, ...a });
    if (within(sale.created_at)) push("sale", sale.created_at, own);
    // Refunds before a void; a void takes back what's left.
    let taken: Amounts = { serviceCents: 0, retailCents: 0, tipCents: 0, lines: own.lines.map((l) => ({ ...l, cents: 0 })) };
    for (const r of sale.refunds) {
      if (sale.voided_at && Date.parse(r.at) > Date.parse(sale.voided_at)) continue;
      const back = takeBack(own, sale.total_cents > 0 ? Math.min(1, r.amount_cents / sale.total_cents) : 0);
      if (within(r.at)) push("refund", r.at, back);
      taken = plus(taken, back);
    }
    if (sale.voided_at && within(sale.voided_at)) {
      const left = plus(own, taken);
      push("void", sale.voided_at, takeBack(left, 1));
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// Scheduled minutes on a day: their hours (a one-off change, else their
// weekly hours) less approved time off.
function minutesOn(schedule: StaffSchedule, date: LocalDate): number {
  const hours = mergeIntervals(schedule.overrides[date] ?? schedule.weekly[weekdayOf(date)] ?? []);
  const off = schedule.timeOff
    .filter((t) => t.status === "approved" && date >= t.startsOn && date <= t.endsOn)
    .map((t) => (t.startMinute != null && t.endMinute != null ? { start: t.startMinute, end: t.endMinute } : { start: 0, end: 1440 }));
  return subtractIntervals(hours, off).reduce((n, i) => n + i.end - i.start, 0);
}

// Scheduled minutes between two dates (inclusive).
export function scheduledMinutes(schedule: StaffSchedule, from: LocalDate, to: LocalDate): number {
  return to < from ? 0 : datesBetween(from, to).reduce((n, d) => n + minutesOn(schedule, d), 0);
}

// Someone's pay history, oldest first: from a date (null: from the start)
// the hourly rate (null: not paid by the hour).
export type RateHistory = { from: LocalDate | null; hourlyRateCents: number | null }[];

export const rateOn = (history: RateHistory, date: LocalDate) => [...history].reverse().find((h) => h.from === null || h.from <= date)?.hourlyRateCents ?? null;

export type Hours = { minutes: number; payCents: number; rates: number[] };

// Hourly pay between two dates: each day's scheduled minutes at the rate in
// effect that day. Null for someone never paid by the hour in the period.
export function hourlyPay(schedule: StaffSchedule, from: LocalDate, to: LocalDate, history: RateHistory): Hours | null {
  if (to < from) return null;
  let minutes = 0;
  let pay = 0;
  const rates = new Set<number>();
  let hourly = false;
  for (const date of datesBetween(from, to)) {
    const rate = rateOn(history, date);
    if (rate === null) continue;
    hourly = true;
    rates.add(rate);
    const m = minutesOn(schedule, date);
    minutes += m;
    pay += (m * rate) / 60;
  }
  return hourly ? { minutes, payCents: Math.round(pay), rates: [...rates].sort((a, b) => a - b) } : null;
}

// The rates a pay line was worked out at (several if they changed), and
// the plans behind it.
export type RatesUsed = { service: number[]; retail: number[]; hourly: number[]; plans: string[] };

export type PayLine = {
  staffId: string;
  name: string;
  role: string;
  rates: RatesUsed;
  serviceCents: number;
  serviceCommissionCents: number;
  retailCents: number;
  retailCommissionCents: number;
  // Back-bar fees taken off services before commission.
  feeCents: number;
  tipCents: number;
  // Scheduled minutes, for people paid by the hour (else null).
  minutes: number | null;
  hourlyPayCents: number;
  // Booth rent owed for the period (taken off their pay).
  rentCents: number;
  totalCents: number;
  tickets: Ticket[];
};

// How plan lines are paid (./commission.ts payLines), and booth rent owed.
export type PlanContext = {
  rulesFor: Parameters<typeof payLines>[1];
  windowOf: Parameters<typeof payLines>[2];
  prior?: Parameters<typeof payLines>[3];
  planName?: (versionId: string) => string | null;
  rentCents?: number;
};

// A saved plan version (commission_rules).
export type PlanVersion = { id: string; planId: string; name: string; rules: PlanRules; createdAt: string };

// Tiers start again each pay period or each month; a window is named by
// the day it starts.
export function tierWindow(rules: PlanRules, date: LocalDate, periodOf: (date: LocalDate) => PayPeriod): string {
  return rules.tierPeriod === "month" ? `month:${monthStart(date)}` : `period:${periodOf(date).from}`;
}

// The earliest day a tier window counting toward this period could start.
export function windowsFrom(period: PayPeriod, periodOf: (date: LocalDate) => PayPeriod): LocalDate {
  const p = periodOf(period.from).from;
  const m = monthStart(period.from);
  return p < m ? p : m;
}

// How someone's plan lines are paid in a period: by their version's rules,
// with what already counted toward each tier window (`before`: their
// tickets from the earliest window's start to the period's), and booth
// rent for `rentDays` from the plan they were on each day (`planOn`), at
// that plan's rules then.
export function planContext(opts: {
  versions: readonly PlanVersion[];
  dayOf: (iso: string) => LocalDate;
  periodOf: (date: LocalDate) => PayPeriod;
  before?: readonly Ticket[];
  rentDays?: readonly LocalDate[];
  planOn?: (date: LocalDate) => string | null;
}): PlanContext {
  const byId = new Map(opts.versions.map((v) => [v.id, v]));
  const rulesFor = (id: string) => byId.get(id)?.rules ?? null;
  const windowOf = (at: string, rules: PlanRules) => tierWindow(rules, opts.dayOf(at), opts.periodOf);
  const prior = new Map<string, Basis>();
  for (const t of opts.before ?? []) {
    for (const l of t.lines) {
      const rules = l.versionId ? rulesFor(l.versionId) : null;
      if (!rules) continue;
      const w = windowOf(t.at, rules);
      const b = prior.get(w) ?? { service: 0, product: 0 };
      b[l.kind] += l.cents;
      prior.set(w, b);
    }
  }
  const versionOn = (planId: string, date: LocalDate) => {
    const of = opts.versions.filter((v) => v.planId === planId);
    return [...of].reverse().find((v) => opts.dayOf(v.createdAt) <= date) ?? of[0] ?? null;
  };
  const rentCents = opts.rentDays && opts.planOn
    ? Math.round(
        rentFor(opts.rentDays, (date) => {
          const plan = opts.planOn!(date);
          const v = plan ? versionOn(plan, date) : null;
          return v && v.rules.mode === "booth_rent" ? v.rules.rent : null;
        }),
      )
    : 0;
  return {
    rulesFor,
    windowOf,
    prior: (w) => ({ ...(prior.get(w) ?? { service: 0, product: 0 }) }),
    planName: (id) => byId.get(id)?.name ?? null,
    rentCents,
  };
}

const NO_PLANS: PlanContext = { rulesFor: () => null, windowOf: () => "" };

const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

export function payLine(person: { staffId: string; name: string; role: string }, tickets: Ticket[], hours: Hours | null, plans: PlanContext = NO_PLANS): PayLine {
  const inputs: PayInput[] = tickets.flatMap((t) => t.lines.map((l) => ({ at: t.at, kind: l.kind, cents: l.cents, soldCents: l.soldCents, quantity: l.quantity, pct: l.pct, versionId: l.versionId })));
  const paid = payLines(inputs, plans.rulesFor, plans.windowOf, plans.prior);
  let n = 0;
  const priced = tickets.map((t) => ({ ...t, lines: t.lines.map((l) => ({ ...l, pay: paid[n++] })) }));
  const lines = priced.flatMap((t) => t.lines);
  const of = (kind: "service" | "product") => lines.filter((l) => l.kind === kind);
  const own = (kind: "service" | "product") => of(kind).filter((l) => !l.versionId || !plans.rulesFor(l.versionId));
  const serviceCents = tickets.reduce((n, t) => n + t.serviceCents, 0);
  const retailCents = tickets.reduce((n, t) => n + t.retailCents, 0);
  const tipCents = tickets.reduce((n, t) => n + t.tipCents, 0);
  // Each line at its own rate or plan, rounded once for the period.
  const serviceCommissionCents = Math.round(of("service").reduce((n, l) => n + l.pay!.commissionCents, 0));
  const retailCommissionCents = Math.round(of("product").reduce((n, l) => n + l.pay!.commissionCents, 0));
  const feeCents = Math.round(lines.reduce((n, l) => n + l.pay!.feeCents, 0));
  const hourly = hours?.payCents ?? 0;
  const rent = plans.rentCents ?? 0;
  const planNames = [...new Set(lines.map((l) => (l.versionId ? (plans.planName?.(l.versionId) ?? null) : null)).filter((x): x is string => x !== null))];
  return {
    ...person,
    rates: { service: unique(own("service").map((l) => l.pct)), retail: unique(own("product").map((l) => l.pct)), hourly: hours?.rates ?? [], plans: planNames },
    serviceCents,
    serviceCommissionCents,
    retailCents,
    retailCommissionCents,
    feeCents,
    tipCents,
    minutes: hours?.minutes ?? null,
    hourlyPayCents: hourly,
    rentCents: rent,
    totalCents: serviceCommissionCents + retailCommissionCents + tipCents + hourly - rent,
    tickets: priced,
  };
}

// "45%", or "45% then 50%" after a change.
export const ratesText = (values: number[], format: (v: number) => string) => values.map(format).join(", ");

export const formatHours = (minutes: number) => (minutes / 60).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");

// One row per person, in dollars, for a payroll provider.
export function payrollCsv(lines: readonly PayLine[], period: PayPeriod): string {
  const header = [
    "Period start",
    "Period end",
    "Staff",
    "Role",
    "Service sales",
    "Service commission %",
    "Service commission",
    "Retail sales",
    "Retail commission %",
    "Retail commission",
    "Tips",
    "Average tip %",
    "Hours",
    "Hourly rate",
    "Hourly pay",
    "Back-bar fees",
    "Booth rent",
    "Plan",
    "Total pay",
  ];
  const rows = lines.map((l) => [
    period.from,
    period.to,
    l.name,
    l.role,
    dollars(l.serviceCents),
    l.rates.service.join("/"),
    dollars(l.serviceCommissionCents),
    dollars(l.retailCents),
    l.rates.retail.join("/"),
    dollars(l.retailCommissionCents),
    dollars(l.tipCents),
    averageTipPct(l.tickets) ?? "",
    l.minutes === null ? "" : formatHours(l.minutes),
    l.rates.hourly.map(dollars).join("/"),
    dollars(l.hourlyPayCents),
    dollars(l.feeCents),
    dollars(l.rentCents),
    l.rates.plans.join("/"),
    dollars(l.totalCents),
  ]);
  return csvTable(header, rows);
}

// The period a page asks for: from and to dates if they make sense (up to
// a year), else the salon's last completed period (the month so far for
// custom salons).
export function requestedPeriod(params: { from?: unknown; to?: unknown }, kind: PayPeriodKind, anchor: LocalDate, today: LocalDate): PayPeriod {
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  const from = date(params.from);
  const to = date(params.to);
  if (from && to && from <= to && daysBetween(from, to) <= 366) return { from, to };
  return kind === "custom" ? { from: periodContaining(kind, anchor, today).from, to: today } : lastCompletedPeriod(kind, anchor, today);
}
