// Stocktakes: reading counts and flagging gaps. Pure, shared by the count
// screen, the server and tests.
//
// Back-bar products are counted as full containers plus what's left in an
// open one (in grams or ml); retail as units.

import { stockValueCents, type ProductUnit } from "./inventory";

// Full containers plus the open one's amount, in the product's unit.
export function countedAmount(full: string, open: string, p: { unit: ProductUnit; size: number }): number | null {
  const f = full.trim() === "" ? 0 : Number(full);
  const o = open.trim() === "" || p.unit === "unit" ? 0 : Number(open);
  if (full.trim() === "" && open.trim() === "") return null;
  if (!Number.isInteger(f) || f < 0 || f > 100000) return null;
  if (!Number.isFinite(o) || o < 0 || o > 100000 || Math.round(o * 100) !== o * 100) return null;
  return Math.round((f * p.size + o) * 100) / 100;
}

// Back the other way, for showing a saved count: 3 tubes + 24 g.
export function splitAmount(amount: number, p: { unit: ProductUnit; size: number }): { full: number; open: number } {
  if (p.unit === "unit") return { full: Math.round(amount), open: 0 };
  const full = Math.floor(amount / p.size + 1e-9);
  return { full, open: Math.round((amount - full * p.size) * 100) / 100 };
}

// Missing stock big enough to look into: worth $15 or more, or a fifth of
// what should be there (ignoring a few grams of weighing error, and single
// retail units).
export const SHRINKAGE_VALUE_CENTS = 1500;
export const SHRINKAGE_SHARE = 0.2;

export function isPossibleShrinkage(expected: number, counted: number, p: { unit: ProductUnit; size: number; cost_cents: number }): boolean {
  const missing = expected - counted;
  if (missing <= 0) return false;
  if (p.unit === "unit" ? missing < 2 : missing < 5) return false;
  const value = stockValueCents(missing, p);
  return value >= SHRINKAGE_VALUE_CENTS || (expected > 0 && missing / expected >= SHRINKAGE_SHARE);
}

export type CountSummary = { counted: number; changed: number; gainCents: number; lossCents: number; flagged: number };

export function summarize(counts: readonly { expected: number; counted: number; product: { unit: ProductUnit; size: number; cost_cents: number } }[]): CountSummary {
  let gainCents = 0;
  let lossCents = 0;
  let changed = 0;
  let flagged = 0;
  for (const c of counts) {
    const diff = c.counted - c.expected;
    if (diff !== 0) changed++;
    if (diff > 0) gainCents += stockValueCents(diff, c.product);
    if (diff < 0) lossCents += stockValueCents(-diff, c.product);
    if (isPossibleShrinkage(c.expected, c.counted, c.product)) flagged++;
  }
  return { counted: counts.length, changed, gainCents, lossCents, flagged };
}
