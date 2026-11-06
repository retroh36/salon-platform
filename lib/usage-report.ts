// Product usage for any period: how much each product was used in services
// and sold, what's on hand and on order, a suggested reorder, and how it
// compares with the same dates last year (or, without a year of history,
// the period before). Pure, so the page and tests share it; the data comes
// from lib/usage-report-load.ts. Denise's line here is our own wording.

import { addDays, daysBetween } from "@/lib/scheduling/time";
import { containersToOrder, type StockInfo } from "./inventory-forecast";

// What moved out over a period, by product and why (product_usage):
// changes are negative for what went out, positive for what came back.
export type UsageTotal = { productId: string; reason: "service_use" | "sale"; change: number };

export type UsageProduct = StockInfo & { name: string; type: "color" | "back_bar" | "retail"; unit: "g" | "ml" | "unit" };

export type UsageRow = {
  productId: string;
  name: string;
  type: UsageProduct["type"];
  unit: UsageProduct["unit"];
  size: number;
  used: number;
  sold: number;
  // Used and sold together.
  out: number;
  onHand: number;
  onOrder: number;
  // Out over the same dates last year (or the period before).
  before: number;
  // Percent change from before, when there was some then.
  changePct: number | null;
  // Containers to order to cover another period like this one and stay
  // above the reorder point (at least the usual quantity), or 0.
  suggested: number;
};

export type Compared = { kind: "last_year" | "previous"; from: string; to: string };

export const MAX_DAYS = 366;

// The period from the address (?from=&to=, local dates), the last 30 days
// by default, at most a year.
export function usagePeriod(params: { from?: string; to?: string }, today: string): { from: string; to: string } {
  const valid = (d: string | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null);
  let to = valid(params.to) ?? today;
  if (to > today) to = today;
  let from = valid(params.from) ?? addDays(to, -29);
  if (from > to) from = to;
  if (daysBetween(from, to) >= MAX_DAYS) from = addDays(to, -(MAX_DAYS - 1));
  return { from, to };
}

// The same dates a year before (Feb 29 becomes Feb 28).
export function lastYear(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const back = `${y - 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return m === 2 && d === 29 ? `${y - 1}-02-28` : back;
}

// What to compare with: the same dates last year when the salon's history
// reaches back that far, else the same length just before.
export function compareWith(period: { from: string; to: string }, firstDay: string | null): Compared {
  const year = { from: lastYear(period.from), to: lastYear(period.to) };
  if (firstDay && firstDay <= year.from) return { kind: "last_year", ...year };
  const length = daysBetween(period.from, period.to) + 1;
  return { kind: "previous", from: addDays(period.from, -length), to: addDays(period.from, -1) };
}

const round = (n: number) => Math.round(n * 100) / 100;

function totals(moves: readonly UsageTotal[]) {
  const out = new Map<string, { used: number; sold: number }>();
  for (const m of moves) {
    const t = out.get(m.productId) ?? { used: 0, sold: 0 };
    if (m.reason === "service_use") t.used -= m.change;
    else t.sold -= m.change;
    out.set(m.productId, t);
  }
  return out;
}

// One row per product that moved in either period, most used first.
export function usageRows(products: readonly UsageProduct[], current: readonly UsageTotal[], earlier: readonly UsageTotal[]): UsageRow[] {
  const now = totals(current);
  const then = totals(earlier);
  const rows: UsageRow[] = [];
  for (const p of products) {
    const t = now.get(p.productId) ?? { used: 0, sold: 0 };
    const b = then.get(p.productId);
    const before = b ? round(b.used + b.sold) : 0;
    const out = round(t.used + t.sold);
    if (out === 0 && before === 0) continue;
    const lowAfter = p.onHand + p.onOrder - out < p.reorderPoint || (p.reorderPoint > 0 && p.onHand + p.onOrder < p.reorderPoint);
    const runsShort = p.onHand + p.onOrder < out;
    rows.push({
      productId: p.productId,
      name: p.name,
      type: p.type,
      unit: p.unit,
      size: p.size,
      used: round(t.used),
      sold: round(t.sold),
      out,
      onHand: p.onHand,
      onOrder: p.onOrder,
      before,
      changePct: before > 0 ? Math.round(((out - before) / before) * 100) : null,
      suggested:
        out > 0 && (lowAfter || runsShort)
          ? containersToOrder(p, { productId: p.productId, needed: out, runsOutAt: null, appointments: 0, colorAppointments: 0, lowNow: false, lowLater: false })
          : 0,
    });
  }
  return rows.sort((a, b) => b.out / b.size - a.out / a.size || a.name.localeCompare(b.name));
}

// How much a percent change has to be before Denise mentions it.
export const NOTABLE_PCT = 15;

// Denise's line: what changed most against the comparison, by type, in
// our words. `when`: the dates last year ("Oct 6 – Nov 4, 2025"), or the
// period's length ("30 days"). Null when there's nothing to compare.
export function usageSummary(rows: readonly UsageRow[], compared: Compared, when: string): string | null {
  const against = compared.kind === "last_year" ? `the same dates last year (${when})` : `the ${when} before`;
  const withBefore = rows.filter((r) => r.before > 0);
  if (!withBefore.length) return null;
  const parts: string[] = [];
  for (const type of ["color", "back_bar", "retail"] as const) {
    const these = rows.filter((r) => r.type === type);
    const now = these.reduce((n, r) => n + r.out / r.size, 0);
    const then = these.reduce((n, r) => n + r.before / r.size, 0);
    if (then <= 0) continue;
    const pct = Math.round(((now - then) / then) * 100);
    const what = type === "color" ? "color" : type === "back_bar" ? "back bar" : "retail";
    parts.push(Math.abs(pct) < 5 ? `${what} is about the same` : `${what} is ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}%`);
  }
  const movers = withBefore
    .filter((r) => r.changePct !== null && Math.abs(r.changePct) >= NOTABLE_PCT && (r.out + r.before) / r.size >= 1)
    .sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!))
    .slice(0, 3)
    .map((r) => `${r.name} ${r.changePct! > 0 ? "+" : "−"}${Math.abs(r.changePct!)}%`);
  const head = `Against ${against}: ${parts.length ? `${parts.join(", ")}.` : "about the same overall."}`;
  return movers.length ? `${head} Biggest changes: ${movers.join(", ")}.` : head;
}
