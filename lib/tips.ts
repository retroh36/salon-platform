// Itemized tips (pure, unit-tested), from the same tickets as payroll so
// the totals always match it: each tip with its date, client, services,
// amount, the tip as a share of those services and how it was paid; totals
// by day, week and pay period; the average tip and the top tippers. Every
// number comes from here.

import type { PayPeriod, Ticket } from "./payroll.ts";
import { csvTable, dollars } from "./csv.ts";
import { addDays, startOfWeek, toLocal, type LocalDate } from "./scheduling/time.ts";

export type TipItem = {
  saleId: string;
  number: number;
  at: string;
  date: LocalDate;
  kind: Ticket["kind"];
  client: string | null;
  services: string[];
  serviceCents: number;
  tipCents: number;
  // The tip as a percent of this stylist's services on the ticket (one
  // decimal); null without services (a tip on retail only).
  pct: number | null;
  paidWith: string | null;
};

export const tipPct = (tipCents: number, serviceCents: number): number | null => (serviceCents > 0 ? Math.round((tipCents / serviceCents) * 1000) / 10 : null);

// Tickets with a tip (refunds and voids take theirs back, as in payroll).
export function tipItems(tickets: readonly Ticket[], timeZone: string): TipItem[] {
  return tickets
    .filter((t) => t.tipCents !== 0)
    .map((t) => ({
      saleId: t.saleId,
      number: t.number,
      at: t.at,
      date: toLocal(new Date(t.at), timeZone).date,
      kind: t.kind,
      client: t.client,
      services: t.lines.filter((l) => l.kind === "service").map((l) => (l.quantity > 1 ? `${l.description} × ${l.quantity}` : l.description)),
      serviceCents: t.serviceCents,
      tipCents: t.tipCents,
      pct: t.kind === "sale" ? tipPct(t.tipCents, t.serviceCents) : null,
      paidWith: t.paidWith,
    }));
}

export type TipTotal = { from: LocalDate; to: LocalDate; cents: number; count: number };

// Tips by day and by week (Monday to Sunday, cut to the period), and for
// the whole period.
export function tipTotals(items: readonly TipItem[], period: PayPeriod): { days: TipTotal[]; weeks: TipTotal[]; total: TipTotal } {
  const group = (key: (i: TipItem) => LocalDate, end: (from: LocalDate) => LocalDate) => {
    const by = new Map<LocalDate, TipTotal>();
    for (const i of items) {
      const from = key(i);
      const t = by.get(from) ?? { from, to: end(from), cents: 0, count: 0 };
      t.cents += i.tipCents;
      if (i.kind === "sale") t.count += 1;
      by.set(from, t);
    }
    return [...by.values()].sort((a, b) => a.from.localeCompare(b.from));
  };
  const clamp = (d: LocalDate, lo: LocalDate, hi: LocalDate) => (d < lo ? lo : d > hi ? hi : d);
  const weekEnd = (from: LocalDate) => clamp(addDays(startOfWeek(from), 6), period.from, period.to);
  return {
    days: group((i) => i.date, (d) => d),
    weeks: group((i) => clamp(startOfWeek(i.date), period.from, period.to), weekEnd),
    total: { from: period.from, to: period.to, cents: items.reduce((n, i) => n + i.tipCents, 0), count: items.filter((i) => i.kind === "sale").length },
  };
}

// Tips as a percent of service sales over the period: every ticket with
// services counts, tipped or not, refunds taken back from both.
export function averageTipPct(tickets: readonly Ticket[]): number | null {
  const service = tickets.reduce((n, t) => n + t.serviceCents, 0);
  const tips = tickets.reduce((n, t) => n + t.tipCents, 0);
  return tipPct(tips, service);
}

export type TopTipper = { client: string; cents: number; visits: number; pct: number | null };

// The clients who tipped the most (net of refunds), with how many tipped
// visits and their average tip. Walk-ins aren't anyone.
export function topTippers(items: readonly TipItem[], limit = 3): TopTipper[] {
  const by = new Map<string, { cents: number; visits: number; service: number }>();
  for (const i of items) {
    if (!i.client) continue;
    const t = by.get(i.client) ?? { cents: 0, visits: 0, service: 0 };
    t.cents += i.tipCents;
    if (i.kind === "sale") {
      t.visits += 1;
      t.service += i.serviceCents;
    }
    by.set(i.client, t);
  }
  return [...by.entries()]
    .filter(([, t]) => t.cents > 0)
    .map(([client, t]) => ({ client, cents: t.cents, visits: t.visits, pct: tipPct(t.cents, t.service) }))
    .sort((a, b) => b.cents - a.cents || a.client.localeCompare(b.client))
    .slice(0, limit);
}

// "18.5%"; "—" without services.
export const pctText = (pct: number | null) => (pct === null ? "—" : `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`);


// Every tip in the period, a row each, for the payroll provider.
export function tipsCsv(people: readonly { name: string; items: readonly TipItem[] }[], period: PayPeriod): string {
  const header = ["Period start", "Period end", "Staff", "Date", "Ticket", "Kind", "Client", "Services", "Service amount", "Tip", "Tip %", "Paid with"];
  const rows = people.flatMap((p) =>
    p.items.map((i) => [
      period.from,
      period.to,
      p.name,
      i.date,
      `#${i.number}`,
      i.kind === "sale" ? "Sale" : i.kind === "refund" ? "Refund" : "Void",
      i.client ?? "Walk-in",
      i.services.join("; "),
      dollars(i.serviceCents),
      dollars(i.tipCents),
      i.pct === null ? "" : String(i.pct),
      i.paidWith ?? "",
    ]),
  );
  return csvTable(header, rows);
}
