import { describe, expect, it } from "vitest";
import { paidWith, ticketsFor, type PayrollSale } from "@/lib/payroll";
import { averageTipPct, pctText, tipItems, tipPct, tipsCsv, tipTotals, topTippers } from "@/lib/tips";

const A = "ana";
const TZ = "America/Chicago";
const period = { from: "2026-10-05", to: "2026-10-18" };
const from = new Date("2026-10-05T05:00:00Z");
const to = new Date("2026-10-19T05:00:00Z");

// Ana's services and tips over two weeks: Ava twice (card), Ben once
// (cash and a gift card), a walk-in who didn't tip, and a retail-only tip.
function sale(id: string, at: string, client: string | null, serviceCents: number, tipCents: number, payments: PayrollSale["payments"] = [{ method: "card", online: false }], over: Partial<PayrollSale> = {}): PayrollSale {
  return {
    id,
    number: Number(id.replace(/\D/g, "")) + 1000,
    created_at: at,
    total_cents: serviceCents + tipCents,
    voided_at: null,
    client,
    lines: serviceCents ? [{ kind: "service", staff_id: A, description: "Balayage", quantity: 1, net_cents: serviceCents, commission_pct: 45 }] : [{ kind: "product", staff_id: A, description: "Shampoo", quantity: 1, net_cents: 2000, commission_pct: 10 }],
    tips: tipCents ? [{ staff_id: A, amount_cents: tipCents }] : [],
    payments,
    refunds: [],
    ...over,
  };
}

const sales = [
  sale("s1", "2026-10-06T15:00:00Z", "Ava Test", 20000, 4000),
  sale("s2", "2026-10-06T20:00:00Z", "Ben Test", 10000, 1500, [
    { method: "cash", online: false },
    { method: "gift_card", online: false },
  ]),
  sale("s3", "2026-10-08T15:00:00Z", null, 5000, 0),
  sale("s4", "2026-10-14T15:00:00Z", "Ava Test", 15000, 3000, [{ method: "card", online: true }]),
  sale("s5", "2026-10-15T15:00:00Z", "Cy Test", 0, 500),
];

describe("itemized tips", () => {
  const tickets = ticketsFor(sales, A, from, to);
  const items = tipItems(tickets, TZ);

  it("lists each tip with its date, client, services, share of the services and how it was paid", () => {
    expect(items.map((i) => [i.date, i.client, i.services, i.tipCents, i.pct, i.paidWith])).toEqual([
      ["2026-10-06", "Ava Test", ["Balayage"], 4000, 20, "Card"],
      ["2026-10-06", "Ben Test", ["Balayage"], 1500, 15, "Cash + Gift card"],
      ["2026-10-14", "Ava Test", ["Balayage"], 3000, 20, "Card online"],
      // A tip on retail only has no service to be a share of.
      ["2026-10-15", "Cy Test", [], 500, null, "Card"],
    ]);
  });

  it("totals them by day, by week (Monday to Sunday) and for the period", () => {
    const t = tipTotals(items, period);
    expect(t.days.map((d) => [d.from, d.cents, d.count])).toEqual([
      ["2026-10-06", 5500, 2],
      ["2026-10-14", 3000, 1],
      ["2026-10-15", 500, 1],
    ]);
    expect(t.weeks).toEqual([
      { from: "2026-10-05", to: "2026-10-11", cents: 5500, count: 2 },
      { from: "2026-10-12", to: "2026-10-18", cents: 3500, count: 2 },
    ]);
    expect(t.total).toEqual({ from: "2026-10-05", to: "2026-10-18", cents: 9000, count: 4 });
  });

  it("averages tips over all service sales, untipped visits included", () => {
    // $90 of tips on $500 of services.
    expect(averageTipPct(tickets)).toBe(18);
    expect(averageTipPct([])).toBeNull();
    expect(tipPct(1234, 10000)).toBe(12.3);
    expect(pctText(18)).toBe("18%");
    expect(pctText(12.3)).toBe("12.3%");
    expect(pctText(null)).toBe("—");
  });

  it("ranks the top tippers, walk-ins left out", () => {
    expect(topTippers(items)).toEqual([
      { client: "Ava Test", cents: 7000, visits: 2, pct: 20 },
      { client: "Ben Test", cents: 1500, visits: 1, pct: 15 },
      { client: "Cy Test", cents: 500, visits: 1, pct: null },
    ]);
    expect(topTippers(items, 1)).toHaveLength(1);
  });

  it("takes back a refunded tip in the period it's refunded, as payroll does", () => {
    const refunded = [sale("s1", "2026-10-06T15:00:00Z", "Ava Test", 20000, 4000, undefined, { refunds: [{ amount_cents: 12000, at: "2026-10-09T15:00:00Z" }] })];
    const back = tipItems(ticketsFor(refunded, A, from, to), TZ);
    expect(back.map((i) => [i.kind, i.tipCents, i.pct])).toEqual([
      ["sale", 4000, 20],
      ["refund", -2000, null],
    ]);
    expect(topTippers(back)).toEqual([{ client: "Ava Test", cents: 2000, visits: 1, pct: 10 }]);
    expect(tipTotals(back, period).total).toMatchObject({ cents: 2000, count: 1 });
  });

  it("names the payment method in a fixed order", () => {
    expect(paidWith([{ method: "gift_card", online: false }, { method: "card", online: false }])).toBe("Card + Gift card");
    expect(paidWith([])).toBeNull();
    expect(paidWith(undefined)).toBeNull();
  });

  it("exports every tip as a row, safe for spreadsheets", () => {
    const csv = tipsCsv([{ name: "=Ana", items }], period).trimEnd().split("\r\n");
    expect(csv[0]).toBe("Period start,Period end,Staff,Date,Ticket,Kind,Client,Services,Service amount,Tip,Tip %,Paid with");
    expect(csv[2]).toBe("2026-10-05,2026-10-18,'=Ana,2026-10-06,#1002,Sale,Ben Test,Balayage,100.00,15.00,15,Cash + Gift card");
    expect(csv).toHaveLength(5);
  });
});
