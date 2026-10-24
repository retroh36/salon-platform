// Checkout arithmetic: a sale's lines, discount, tax, tips and total, and
// how the payments stand against it. The database does the same in
// private.price_sale / complete_sale (the tests check they agree); this is
// for showing it as staff build the sale. Pure.

export type PaymentMethod = "cash" | "card" | "gift_card" | "package" | "membership";

export const METHOD_LABELS: Record<PaymentMethod, string> = { cash: "Cash", card: "Card", gift_card: "Gift card", package: "Package", membership: "Membership" };

export type SaleLine = {
  // Before discount and tax: unit price × quantity.
  grossCents: number;
  // Tax rate in basis points (825 = 8.25%).
  taxBp: number;
  // Whether the sale's discount applies to it.
  discountable: boolean;
  // Its own discount, taken off before the sale's is shared out.
  lineDiscountCents?: number;
};

export type Discount = { kind: "amount" | "percent"; value: number } | null;

export type PricedLine = { discountCents: number; taxCents: number; totalCents: number };

export type SaleTotals = {
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
};

// The discount in cents: a percentage of what can be discounted, or an
// amount (never more than that).
const afterOwn = (l: SaleLine) => l.grossCents - (l.lineDiscountCents ?? 0);

// A line's own discount in cents (an amount or a percentage of it).
export function lineDiscountCents(grossCents: number, discount: Discount): number {
  if (!discount || discount.value <= 0) return 0;
  const cents = discount.kind === "percent" ? Math.round((grossCents * Math.min(discount.value, 100)) / 100) : Math.round(discount.value);
  return Math.min(cents, grossCents);
}

export function discountCents(lines: readonly SaleLine[], discount: Discount): number {
  if (!discount || discount.value <= 0) return 0;
  const pool = lines.filter((l) => l.discountable).reduce((n, l) => n + afterOwn(l), 0);
  const cents = discount.kind === "percent" ? Math.round((pool * Math.min(discount.value, 100)) / 100) : Math.round(discount.value);
  return Math.min(cents, pool);
}

// Each line's share of the discount (in proportion, rounded down, the
// cents left over to the first lines), then its tax, rounded per line.
export function priceLines(lines: readonly SaleLine[], discount: number): PricedLine[] {
  const pool = lines.filter((l) => l.discountable).reduce((n, l) => n + afterOwn(l), 0);
  const shares = lines.map((l) => (l.discountable && pool > 0 ? Math.floor((discount * afterOwn(l)) / pool) : 0));
  let left = discount - shares.reduce((n, s) => n + s, 0);
  return lines.map((l, i) => {
    if (left > 0 && l.discountable && afterOwn(l) > shares[i]) {
      shares[i] += 1;
      left -= 1;
    }
    const own = l.lineDiscountCents ?? 0;
    const net = afterOwn(l) - shares[i];
    const tax = Math.round((net * l.taxBp) / 10_000);
    return { discountCents: own + shares[i], taxCents: tax, totalCents: net + tax };
  });
}

export function computeSale(lines: readonly SaleLine[], discount: Discount, tipsCents: readonly number[]): SaleTotals {
  const off = discountCents(lines, discount);
  const priced = priceLines(lines, off);
  const subtotal = lines.reduce((n, l) => n + l.grossCents, 0);
  const own = lines.reduce((n, l) => n + (l.lineDiscountCents ?? 0), 0);
  const tax = priced.reduce((n, l) => n + l.taxCents, 0);
  const tips = tipsCents.reduce((n, t) => n + Math.max(0, t), 0);
  return { lines: priced, subtotalCents: subtotal, discountCents: own + off, taxCents: tax, tipCents: tips, totalCents: subtotal - own - off + tax + tips };
}

export type Tender = { method: PaymentMethod; amountCents: number; tenderedCents?: number };

// How the payments stand: what's still due (or over), and change for cash.
export function paymentStatus(totalCents: number, tenders: readonly Tender[]) {
  const paid = tenders.reduce((n, t) => n + Math.max(0, t.amountCents), 0);
  const change = tenders.reduce((n, t) => n + (t.method === "cash" && t.tenderedCents !== undefined ? Math.max(0, t.tenderedCents - t.amountCents) : 0), 0);
  return { paidCents: paid, dueCents: totalCents - paid, changeCents: change, settled: paid === totalCents };
}

// Whether someone may give this discount: their role is allowed, and
// unless they're an owner or manager, it's within the salon's limit.
export function discountAllowed(role: string, settings: { roles: readonly string[]; maxPercent: number }, discountCents: number, poolCents: number): { ok: true } | { ok: false; message: string } {
  if (discountCents <= 0) return { ok: true };
  if (!settings.roles.includes(role)) return { ok: false, message: "You can't give discounts. Ask a manager." };
  if (role !== "owner" && role !== "manager" && discountCents * 100 > poolCents * settings.maxPercent) {
    return { ok: false, message: `You can give up to ${settings.maxPercent}% off. Ask a manager for more.` };
  }
  return { ok: true };
}

// "8.25%" from basis points.
export function formatRate(bp: number): string {
  return `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

// Dollars typed by staff ("12", "12.5", "$12.50") to cents; null if it
// isn't an amount.
export function parseDollars(text: string): number | null {
  const t = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

// Tip presets on a stylist's services: 18%, 20% and 25%, to the cent.
export const TIP_PERCENTS = [18, 20, 25] as const;
export function tipFor(servicesCents: number, percent: number): number {
  return Math.round((servicesCents * percent) / 100);
}

// Quick cash amounts for what's due: exact, then the next round notes.
export function quickCash(dueCents: number): number[] {
  if (dueCents <= 0) return [];
  const notes = [2000, 5000, 10000].map((n) => Math.ceil(dueCents / n) * n);
  return [...new Set([dueCents, ...notes])].sort((a, b) => a - b).slice(0, 4);
}
