import { describe, expect, it } from "vitest";
import { parseReconcileRange, reconcile, reconcileCsv, reconcileTotals, type ReconcilePayment } from "@/lib/reconcile";

const pay = (day: string, method: ReconcilePayment["method"], cents: number, processor: string | null = null): ReconcilePayment => ({ day, method, amount_cents: cents, processor });

describe("reconciling sales to money", () => {
  const range = { from: "2026-11-02", to: "2026-11-04" };
  const payments = [
    pay("2026-11-02", "cash", 8000),
    pay("2026-11-02", "card", 12000),
    pay("2026-11-02", "gift_card", 3000),
    pay("2026-11-03", "card", 5000, "test"),
    pay("2026-11-03", "cash", -2000),
    pay("2026-11-04", "cash", 4500),
  ];
  const sales = [
    { day: "2026-11-02", totalCents: 23000 },
    { day: "2026-11-03", totalCents: 4000 },
  ];
  const closes = [
    { day: "2026-11-02", expectedCents: 28000, countedCents: 28000, depositCents: 8000, by: "Daniel Okafor" },
    { day: "2026-11-03", expectedCents: 18000, countedCents: 17500, depositCents: 0, by: "Daniel Okafor" },
  ];
  const days = reconcile(range, payments, sales, closes);

  it("puts each day's money by type, newest first, with credit apart from money in", () => {
    expect(days.map((d) => d.day)).toEqual(["2026-11-04", "2026-11-03", "2026-11-02"]);
    const mon = days[2];
    expect(mon.tenders.cash.netCents).toBe(8000);
    expect(mon.tenders.gift_card.netCents).toBe(3000);
    expect(mon.moneyInCents).toBe(20000);
    expect(mon.unmatchedCents).toBe(0);
    expect(mon.toBankCents).toBe(8000 + 12000);
    expect(mon.issues).toEqual([]);
  });

  it("flags cash that's off and cash days with no close-out", () => {
    expect(days[1].tenders.card_on_file.netCents).toBe(5000);
    expect(days[1].tenders.cash.refundedCents).toBe(2000);
    expect(days[1].unmatchedCents).toBe(1000);
    expect(days[1].issues).toEqual(["cash_off"]);
    expect(days[0].issues).toEqual(["no_closeout"]);
    // No close-out yet: the net cash is what should reach the bank.
    expect(days[0].toBankCents).toBe(4500);
  });

  it("totals the range and exports a row per day, oldest first", () => {
    const t = reconcileTotals(days);
    expect(t).toMatchObject({ salesCents: 27000, cashCents: 10500, deskCardCents: 12000, onlineCardCents: 5000, creditCents: 3000, refundedCents: 2000, depositedCents: 8000, cashOffCents: -500, issues: 2 });
    const csv = reconcileCsv(days).split("\r\n");
    expect(csv[0].startsWith("Date,Sales,Sales total,Cash taken")).toBe(true);
    expect(csv[1]).toBe("2026-11-02,1,230.00,80.00,0.00,80.00,280.00,280.00,0.00,80.00,120.00,0.00,30.00,0.00,0.00,0.00,200.00,200.00,Daniel Okafor,");
    expect(csv[3].endsWith(",No close-out")).toBe(true);
  });

  it("reads the dates: this month by default, never past today or over 92 days", () => {
    expect(parseReconcileRange({}, "2026-11-05")).toEqual({ from: "2026-11-01", to: "2026-11-05" });
    expect(parseReconcileRange({ from: "2026-01-01", to: "2026-12-31" }, "2026-11-05")).toEqual({ from: "2026-08-06", to: "2026-11-05" });
    expect(parseReconcileRange({ from: "2026-11-04", to: "2026-11-02" }, "2026-11-05")).toEqual({ from: "2026-11-02", to: "2026-11-02" });
  });
});
