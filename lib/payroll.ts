// Payroll and commission (pure, unit-tested): pay periods, each sale's
// effect on a staff member's pay, and the totals for a period.
//
// A sale counts in the period it was completed. A refund counts in the
// period it was given, taking back the same share of every line and tip
// (a $30 refund on a $120 sale takes back a quarter of each). A void counts
// in the period it was voided, taking back whatever was left. So a sale
// paid in one period and refunded in the next is paid, then clawed back,
// and nothing is ever paid twice. Commission is worked out on the period's
// totals, ex tax and after discounts, at the staff member's current rates.

import { csvTable, dollars } from "./csv.ts";
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
  lines: { kind: "service" | "product"; staff_id: string; description: string; quantity: number; net_cents: number }[];
  tips: { staff_id: string; amount_cents: number }[];
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
  serviceCents: number;
  retailCents: number;
  tipCents: number;
  lines: { description: string; kind: "service" | "product"; quantity: number; cents: number }[];
};

type Amounts = { serviceCents: number; retailCents: number; tipCents: number; lines: Ticket["lines"] };

function ownShare(sale: PayrollSale, staffId: string): Amounts {
  const lines = sale.lines.filter((l) => l.staff_id === staffId).map((l) => ({ description: l.description, kind: l.kind, quantity: l.quantity, cents: l.net_cents }));
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
    const base = { saleId: sale.id, number: sale.number, client: sale.client };
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

// Scheduled minutes between two dates (inclusive): their hours each day
// (a one-off change, else their weekly hours) less approved time off.
export function scheduledMinutes(schedule: StaffSchedule, from: LocalDate, to: LocalDate): number {
  if (to < from) return 0;
  let minutes = 0;
  for (const date of datesBetween(from, to)) {
    const hours = mergeIntervals(schedule.overrides[date] ?? schedule.weekly[weekdayOf(date)] ?? []);
    const off = schedule.timeOff
      .filter((t) => t.status === "approved" && date >= t.startsOn && date <= t.endsOn)
      .map((t) => (t.startMinute != null && t.endMinute != null ? { start: t.startMinute, end: t.endMinute } : { start: 0, end: 1440 }));
    minutes += subtractIntervals(hours, off).reduce((n, i) => n + i.end - i.start, 0);
  }
  return minutes;
}

export type Compensation = { servicePct: number; retailPct: number; hourlyRateCents: number | null };

export type PayLine = {
  staffId: string;
  name: string;
  role: string;
  comp: Compensation;
  serviceCents: number;
  serviceCommissionCents: number;
  retailCents: number;
  retailCommissionCents: number;
  tipCents: number;
  // Scheduled minutes, for people paid by the hour (else null).
  minutes: number | null;
  hourlyPayCents: number;
  totalCents: number;
  tickets: Ticket[];
};

export function payLine(person: { staffId: string; name: string; role: string }, comp: Compensation, tickets: Ticket[], minutes: number | null): PayLine {
  const serviceCents = tickets.reduce((n, t) => n + t.serviceCents, 0);
  const retailCents = tickets.reduce((n, t) => n + t.retailCents, 0);
  const tipCents = tickets.reduce((n, t) => n + t.tipCents, 0);
  const serviceCommissionCents = Math.round((serviceCents * comp.servicePct) / 100);
  const retailCommissionCents = Math.round((retailCents * comp.retailPct) / 100);
  const hourly = comp.hourlyRateCents !== null && minutes !== null ? Math.round((minutes * comp.hourlyRateCents) / 60) : 0;
  return {
    ...person,
    comp,
    serviceCents,
    serviceCommissionCents,
    retailCents,
    retailCommissionCents,
    tipCents,
    minutes: comp.hourlyRateCents !== null ? minutes : null,
    hourlyPayCents: hourly,
    totalCents: serviceCommissionCents + retailCommissionCents + tipCents + hourly,
    tickets,
  };
}

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
    "Hours",
    "Hourly rate",
    "Hourly pay",
    "Total pay",
  ];
  const rows = lines.map((l) => [
    period.from,
    period.to,
    l.name,
    l.role,
    dollars(l.serviceCents),
    l.comp.servicePct,
    dollars(l.serviceCommissionCents),
    dollars(l.retailCents),
    l.comp.retailPct,
    dollars(l.retailCommissionCents),
    dollars(l.tipCents),
    l.minutes === null ? "" : formatHours(l.minutes),
    l.comp.hourlyRateCents === null ? "" : dollars(l.comp.hourlyRateCents),
    dollars(l.hourlyPayCents),
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
