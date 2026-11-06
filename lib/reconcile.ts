import { csvTable, dollars } from "@/lib/csv";
import { TENDERS, tenderOf, type PaymentRow, type Tender } from "@/lib/reports";
import { addDays, isLocalDate, type LocalDate } from "@/lib/scheduling/time";

// Matching sales to money for the bookkeeper (Reports → Reconcile, the
// `reports` permission): day by day, the sales rung up, the money taken and
// given back by type of payment, the cash drawer's close-out (expected,
// counted, deposited), and what should reach the bank (cash deposited, and
// cards at the desk and online, net). Gift cards, packages and memberships
// are paid for already, so they're shown but never money in. Card batches
// and payouts join this once Stripe is live. Pure.

export type ReconcilePayment = PaymentRow & { day: LocalDate; reference?: string | null };
export type ReconcileSale = { day: LocalDate; totalCents: number };
export type ReconcileClose = { day: LocalDate; expectedCents: number; countedCents: number; depositCents: number; by: string | null };

// Money in; the rest is credit used up. "Other" (a check, a transfer) is
// money in that reaches the bank its own way, so it's flagged with its notes
// to match by hand rather than counted in "To the bank".
export const MONEY_TENDERS: readonly Tender[] = ["cash", "card", "card_on_file", "other"];

export type ReconcileDay = {
  day: LocalDate;
  salesCents: number;
  sales: number;
  // By tender: taken, refunded (refunds and voids, positive) and net.
  tenders: Record<Tender, { takenCents: number; refundedCents: number; netCents: number }>;
  // Cash, cards at the desk and online, net.
  moneyInCents: number;
  // Payments taken this day less the sales rung up this day: an event or a
  // deposit paid on another day, never a mistake by itself.
  unmatchedCents: number;
  close: ReconcileClose | null;
  // What should reach the bank: the deposit, else the net cash (no close-out
  // yet), plus cards net.
  toBankCents: number;
  // What staff wrote for each "Other" payment taken that day.
  otherNotes: string[];
  issues: ("no_closeout" | "cash_off" | "paid_other")[];
};

export type ReconcileRange = { from: LocalDate; to: LocalDate };

export const RECONCILE_MAX_DAYS = 92;

// From the address: this month so far by default, never past today, never
// more than RECONCILE_MAX_DAYS.
export function parseReconcileRange(params: Record<string, string | string[] | undefined>, today: LocalDate): ReconcileRange {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  let to = isLocalDate(one("to")) ? one("to") : today;
  if (to > today) to = today;
  let from = isLocalDate(one("from")) ? one("from") : `${to.slice(0, 8)}01`;
  if (from > to) from = to;
  if (from < addDays(to, -(RECONCILE_MAX_DAYS - 1))) from = addDays(to, -(RECONCILE_MAX_DAYS - 1));
  return { from, to };
}

export function reconcile(range: ReconcileRange, payments: readonly ReconcilePayment[], sales: readonly ReconcileSale[], closes: readonly ReconcileClose[]): ReconcileDay[] {
  const days: ReconcileDay[] = [];
  for (let day = range.to; day >= range.from; day = addDays(day, -1)) {
    const mine = payments.filter((p) => p.day === day);
    const tenders = Object.fromEntries(
      TENDERS.map((t) => {
        const rows = mine.filter((p) => tenderOf(p) === t);
        const taken = rows.filter((p) => p.amount_cents > 0).reduce((n, p) => n + p.amount_cents, 0);
        const refunded = -rows.filter((p) => p.amount_cents < 0).reduce((n, p) => n + p.amount_cents, 0);
        return [t, { takenCents: taken, refundedCents: refunded, netCents: taken - refunded }];
      }),
    ) as ReconcileDay["tenders"];
    const rung = sales.filter((s) => s.day === day);
    const salesCents = rung.reduce((n, s) => n + s.totalCents, 0);
    const taken = TENDERS.reduce((n, t) => n + tenders[t].takenCents, 0);
    const moneyInCents = MONEY_TENDERS.reduce((n, t) => n + tenders[t].netCents, 0);
    const close = closes.find((c) => c.day === day) ?? null;
    const cards = tenders.card.netCents + tenders.card_on_file.netCents;
    const issues: ReconcileDay["issues"] = [];
    if (!close && tenders.cash.takenCents + tenders.cash.refundedCents > 0) issues.push("no_closeout");
    if (close && close.countedCents !== close.expectedCents) issues.push("cash_off");
    const otherNotes = mine.filter((p) => p.method === "other" && p.amount_cents > 0).map((p) => p.reference?.trim() || "No note");
    if (otherNotes.length) issues.push("paid_other");
    days.push({
      day,
      salesCents,
      sales: rung.length,
      tenders,
      moneyInCents,
      unmatchedCents: taken - salesCents,
      close,
      toBankCents: (close ? close.depositCents : tenders.cash.netCents) + cards,
      otherNotes,
      issues,
    });
  }
  return days;
}

// The range's totals, for the foot of the table.
export function reconcileTotals(days: readonly ReconcileDay[]) {
  const sum = (f: (d: ReconcileDay) => number) => days.reduce((n, d) => n + f(d), 0);
  return {
    salesCents: sum((d) => d.salesCents),
    cashCents: sum((d) => d.tenders.cash.netCents),
    deskCardCents: sum((d) => d.tenders.card.netCents),
    onlineCardCents: sum((d) => d.tenders.card_on_file.netCents),
    otherCents: sum((d) => d.tenders.other.netCents),
    creditCents: sum((d) => d.tenders.gift_card.netCents + d.tenders.package.netCents + d.tenders.membership.netCents),
    refundedCents: sum((d) => TENDERS.reduce((n, t) => n + d.tenders[t].refundedCents, 0)),
    depositedCents: sum((d) => d.close?.depositCents ?? 0),
    cashOffCents: sum((d) => (d.close ? d.close.countedCents - d.close.expectedCents : 0)),
    toBankCents: sum((d) => d.toBankCents),
    issues: days.filter((d) => d.issues.length > 0).length,
  };
}

// A row per day, oldest first, in dollars: for QuickBooks, Xero or a
// spreadsheet.
export function reconcileCsv(days: readonly ReconcileDay[]): string {
  return csvTable(
    [
      "Date",
      "Sales",
      "Sales total",
      "Cash taken",
      "Cash refunded",
      "Cash net",
      "Cash expected",
      "Cash counted",
      "Cash over/short",
      "Cash deposited",
      "Card at the desk net",
      "Card online net",
      "Other net",
      "Gift card used",
      "Package used",
      "Membership used",
      "Refunds and voids",
      "Money in",
      "To the bank",
      "Closed out by",
      "Other notes",
      "Check",
    ],
    [...days].reverse().map((d) => [
      d.day,
      d.sales,
      dollars(d.salesCents),
      dollars(d.tenders.cash.takenCents),
      dollars(d.tenders.cash.refundedCents),
      dollars(d.tenders.cash.netCents),
      d.close ? dollars(d.close.expectedCents) : "",
      d.close ? dollars(d.close.countedCents) : "",
      d.close ? dollars(d.close.countedCents - d.close.expectedCents) : "",
      d.close ? dollars(d.close.depositCents) : "",
      dollars(d.tenders.card.netCents),
      dollars(d.tenders.card_on_file.netCents),
      dollars(d.tenders.other.netCents),
      dollars(d.tenders.gift_card.netCents),
      dollars(d.tenders.package.netCents),
      dollars(d.tenders.membership.netCents),
      dollars(TENDERS.reduce((n, t) => n + d.tenders[t].refundedCents, 0)),
      dollars(d.moneyInCents),
      dollars(d.toBankCents),
      d.close?.by ?? "",
      d.otherNotes.join("; "),
      d.issues.map((i) => ISSUE_TEXT[i]).join("; "),
    ]),
  );
}

export const ISSUE_TEXT: Record<ReconcileDay["issues"][number], string> = { no_closeout: "No close-out", cash_off: "Cash over or short", paid_other: "Paid by other" };

export type PaymentLine = { at: string; day: LocalDate; saleNumber: number; tender: Tender; amountCents: number; reference: string | null };

// Every payment in the range, oldest first: for matching card batches and
// deposits line by line.
export function paymentsCsv(lines: readonly PaymentLine[], labels: Record<Tender, string>, time: (iso: string) => string): string {
  return csvTable(
    ["Date", "Time", "Sale", "Payment", "Amount", "Reference"],
    [...lines].sort((a, b) => a.at.localeCompare(b.at)).map((l) => [l.day, time(l.at), l.saleNumber, labels[l.tender], dollars(l.amountCents), l.reference]),
  );
}
