// The owners' reports, worked out from rows: what's owed on gift cards,
// what unused packages are worth, gift card activity over a period, and a
// day's money by tender for the close-out. Pure (loading is in
// ./reports-load.ts); Denise's answers about them use these too.

import { METHOD_LABELS, type PaymentMethod } from "./checkout";

export type CardRow = { kind: "purchased" | "promotional"; status: "active" | "voided"; balance_cents: number; expires_at: string | null };

const live = (c: CardRow, now: Date) => c.status === "active" && (c.expires_at === null || new Date(c.expires_at) > now);

// Balances still on cards: purchased ones are money owed in services;
// promotional ones are tracked apart (no cash value); expired balances
// apart again (what happens to them depends on state law).
export function giftCardLiability(cards: readonly CardRow[], now = new Date()) {
  const sum = (keep: (c: CardRow) => boolean) => {
    const rows = cards.filter((c) => c.balance_cents > 0 && keep(c));
    return { cents: rows.reduce((n, c) => n + c.balance_cents, 0), count: rows.length };
  };
  return {
    purchased: sum((c) => c.kind === "purchased" && live(c, now)),
    promotional: sum((c) => c.kind === "promotional" && live(c, now)),
    expired: sum((c) => c.status === "active" && !live(c, now)),
  };
}

export type PackageItemRow = { client_id: string; status: "active" | "canceled" | "refunded"; expires_at: string | null; total: number; used: number; use_value_cents: number };

// What the uses not yet taken on active packages are worth (services still
// owed), and how many clients have them.
export function unusedPackageValue(items: readonly PackageItemRow[], now = new Date()) {
  const open = items.filter((i) => i.status === "active" && (i.expires_at === null || new Date(i.expires_at) > now) && i.used < i.total);
  return {
    cents: open.reduce((n, i) => n + (i.total - i.used) * i.use_value_cents, 0),
    uses: open.reduce((n, i) => n + (i.total - i.used), 0),
    clients: new Set(open.map((i) => i.client_id)).size,
  };
}

export type CardEventRow = { kind: string; amount_cents: number; card_kind: "purchased" | "promotional" };

// Gift card money in and out over a period.
export function giftCardActivity(events: readonly CardEventRow[]) {
  const total = (kind: string, cardKind: CardEventRow["card_kind"]) =>
    events.filter((e) => e.kind === kind && e.card_kind === cardKind).reduce((n, e) => n + Math.abs(e.amount_cents), 0);
  const count = (kind: string, cardKind: CardEventRow["card_kind"]) => events.filter((e) => e.kind === kind && e.card_kind === cardKind).length;
  return {
    soldCents: total("sold", "purchased"),
    soldCount: count("sold", "purchased"),
    reloadedCents: total("reloaded", "purchased"),
    // Used at checkout, less what was put back by refunds and voids.
    redeemedCents: total("redeemed", "purchased") - total("refunded", "purchased"),
    promoIssuedCents: total("issued", "promotional"),
    promoRedeemedCents: total("redeemed", "promotional") - total("refunded", "promotional"),
  };
}

// processor: taken by a payment provider (a membership renewal, a payment
// link), not at the desk.
export type PaymentRow = { method: PaymentMethod; amount_cents: number; processor?: string | null };

export type Tender = PaymentMethod | "card_on_file";
const TENDERS: Tender[] = ["cash", "card", "card_on_file", "gift_card", "package", "membership"];
export const TENDER_LABELS: Record<Tender, string> = { ...METHOD_LABELS, card: "Card at the desk", card_on_file: "Card online" };

const tenderOf = (p: PaymentRow): Tender => (p.method === "card" && p.processor ? "card_on_file" : p.method);

// A day's money by tender: taken, refunded (including voids), and net, with
// cards taken online (renewals, payment links) apart from the desk's
// terminal. The cash that should be in the drawer is the net cash (change
// given is already left out of the amounts).
// The day's money by tender, and the cash that should be in the drawer: the
// starting float plus cash taken, less cash refunds and voids (as
// save_closeout works it out).
export function closeout(payments: readonly PaymentRow[], floatCents = 0) {
  const byMethod = TENDERS.map((method) => {
    const rows = payments.filter((p) => tenderOf(p) === method);
    const taken = rows.filter((p) => p.amount_cents > 0).reduce((n, p) => n + p.amount_cents, 0);
    const refunded = -rows.filter((p) => p.amount_cents < 0).reduce((n, p) => n + p.amount_cents, 0);
    return { method, takenCents: taken, refundedCents: refunded, netCents: taken - refunded };
  });
  const cashNetCents = byMethod.find((m) => m.method === "cash")!.netCents;
  return { byMethod, floatCents, cashNetCents, expectedCashCents: floatCents + cashNetCents, netCents: byMethod.reduce((n, m) => n + m.netCents, 0) };
}

export type RebookRow = { staff_id: string | null; rebooked: boolean };

// Rebooked before leaving, per stylist: of the visits they checked out (the
// visit's main stylist), how many left with their next one booked.
export function rebookingAtCheckout(rows: readonly RebookRow[]) {
  const by = new Map<string, { visits: number; rebooked: number }>();
  for (const r of rows) {
    if (!r.staff_id) continue;
    const s = by.get(r.staff_id) ?? { visits: 0, rebooked: 0 };
    s.visits += 1;
    if (r.rebooked) s.rebooked += 1;
    by.set(r.staff_id, s);
  }
  const rate = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const stylists = [...by.entries()].map(([staffId, s]) => ({ staffId, ...s, percent: rate(s.rebooked, s.visits) })).sort((a, b) => b.percent - a.percent || b.visits - a.visits);
  const visits = stylists.reduce((n, s) => n + s.visits, 0);
  const rebooked = stylists.reduce((n, s) => n + s.rebooked, 0);
  return { visits, rebooked, percent: rate(rebooked, visits), stylists };
}
