import { describe, expect, it } from "vitest";
import {
  lastCompletedPeriod,
  nextPeriod,
  payLine,
  payrollCsv,
  periodContaining,
  previousPeriod,
  hourlyPay,
  rateOn,
  requestedPeriod,
  scheduledMinutes,
  ticketsFor,
  type PayrollSale,
} from "@/lib/payroll";

const A = "staff-a";
const B = "staff-b";
const from = new Date("2026-10-05T05:00:00Z");
const to = new Date("2026-10-19T05:00:00Z");

// A $120 sale: Ana's $80 cut and $20 shampoo, Ben's $10 of the retail
// ($11 with tax), and a $10 tip for Ana.
function sale(over: Partial<PayrollSale> = {}): PayrollSale {
  return {
    id: "s1",
    number: 1001,
    created_at: "2026-10-07T16:00:00Z",
    total_cents: 12000,
    voided_at: null,
    client: "Ava Test",
    lines: [
      // Each at the rate recorded when it was sold.
      { kind: "service", staff_id: A, description: "Cut", quantity: 1, net_cents: 8000, commission_pct: 45 },
      { kind: "product", staff_id: A, description: "Shampoo", quantity: 1, net_cents: 2000, commission_pct: 15 },
      { kind: "product", staff_id: B, description: "Spray", quantity: 1, net_cents: 1000, commission_pct: 10 },
    ],
    tips: [{ staff_id: A, amount_cents: 1000 }],
    refunds: [],
    ...over,
  };
}

describe("pay periods", () => {
  it("counts weekly and biweekly periods from the anchor, either side of it", () => {
    expect(periodContaining("weekly", "2026-01-05", "2026-10-23")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(periodContaining("biweekly", "2026-01-05", "2026-10-23")).toEqual({ from: "2026-10-12", to: "2026-10-25" });
    expect(periodContaining("biweekly", "2026-01-05", "2026-10-11")).toEqual({ from: "2026-09-28", to: "2026-10-11" });
    expect(periodContaining("weekly", "2026-01-05", "2025-12-31")).toEqual({ from: "2025-12-29", to: "2026-01-04" });
  });

  it("splits months at the 15th for semi-monthly, to the month's real end", () => {
    expect(periodContaining("semi_monthly", "2026-01-05", "2026-02-15")).toEqual({ from: "2026-02-01", to: "2026-02-15" });
    expect(periodContaining("semi_monthly", "2026-01-05", "2026-02-16")).toEqual({ from: "2026-02-16", to: "2026-02-28" });
    expect(periodContaining("semi_monthly", "2026-01-05", "2028-02-20").to).toBe("2028-02-29");
    expect(previousPeriod("semi_monthly", "2026-01-05", { from: "2026-03-01", to: "2026-03-15" })).toEqual({ from: "2026-02-16", to: "2026-02-28" });
    expect(nextPeriod("semi_monthly", "2026-01-05", { from: "2026-12-16", to: "2026-12-31" })).toEqual({ from: "2027-01-01", to: "2027-01-15" });
  });

  it("starts custom at the calendar month, and payroll at the last period that's over", () => {
    expect(periodContaining("custom", "2026-01-05", "2026-10-23")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(lastCompletedPeriod("biweekly", "2026-01-05", "2026-10-23")).toEqual({ from: "2026-09-28", to: "2026-10-11" });
  });
});

describe("tickets behind the pay", () => {
  it("takes each person's own lines and tips, ex tax", () => {
    const [t] = ticketsFor([sale()], A, from, to);
    expect(t).toMatchObject({ kind: "sale", number: 1001, serviceCents: 8000, retailCents: 2000, tipCents: 1000 });
    expect(ticketsFor([sale()], B, from, to)[0]).toMatchObject({ serviceCents: 0, retailCents: 1000, tipCents: 0 });
    expect(ticketsFor([sale()], "nobody", from, to)).toEqual([]);
  });

  it("takes back a refund's share of every line and tip, in the period it was given", () => {
    // $30 back on $120: a quarter of everything.
    const refunded = sale({ refunds: [{ amount_cents: 3000, at: "2026-10-10T16:00:00Z" }] });
    const [paid, back] = ticketsFor([refunded], A, from, to);
    expect(paid.kind).toBe("sale");
    expect(back).toMatchObject({ kind: "refund", serviceCents: -2000, retailCents: -500, tipCents: -250 });
    // A sale from an earlier period, refunded in this one: only the claw-back.
    const earlier = sale({ created_at: "2026-09-30T16:00:00Z", refunds: [{ amount_cents: 3000, at: "2026-10-10T16:00:00Z" }] });
    expect(ticketsFor([earlier], A, from, to).map((t) => t.kind)).toEqual(["refund"]);
  });

  it("voids in the same period cancel out; a later void takes back what was left", () => {
    const sameDay = sale({ voided_at: "2026-10-07T17:00:00Z" });
    const tickets = ticketsFor([sameDay], A, from, to);
    expect(tickets.map((t) => t.kind)).toEqual(["sale", "void"]);
    const pay = payLine({ staffId: A, name: "Ana", role: "Stylist" }, tickets, null);
    expect(pay).toMatchObject({ serviceCents: 0, retailCents: 0, tipCents: 0, totalCents: 0 });

    // Paid last period, a quarter refunded, then voided this period.
    const later = sale({ created_at: "2026-09-30T16:00:00Z", refunds: [{ amount_cents: 3000, at: "2026-10-01T16:00:00Z" }], voided_at: "2026-10-08T16:00:00Z" });
    const [v] = ticketsFor([later], A, from, to);
    expect(v).toMatchObject({ kind: "void", serviceCents: -6000, retailCents: -1500, tipCents: -750 });
  });
});

describe("pay", () => {
  it("pays each line at the rate recorded when it was sold, plus tips and hourly pay", () => {
    // The second sale was made after a raise to 50%.
    const raised = sale({ id: "s2", number: 1002, lines: sale().lines.map((l) => (l.kind === "service" ? { ...l, commission_pct: 50 } : l)) });
    const tickets = ticketsFor([sale(), raised], A, from, to);
    const pay = payLine({ staffId: A, name: "Ana Test", role: "Stylist" }, tickets, { minutes: 600, payCents: 15000, rates: [1500] });
    expect(pay).toMatchObject({
      serviceCents: 16000,
      serviceCommissionCents: 3600 + 4000,
      retailCents: 4000,
      retailCommissionCents: 600,
      tipCents: 2000,
      minutes: 600,
      hourlyPayCents: 15000,
      totalCents: 7600 + 600 + 2000 + 15000,
      rates: { service: [45, 50], retail: [15], hourly: [1500] },
    });
    // A refund takes back at the rate it was paid at.
    const refunded = ticketsFor([sale({ created_at: "2026-09-30T16:00:00Z", refunds: [{ amount_cents: 3000, at: "2026-10-10T16:00:00Z" }] })], A, from, to);
    expect(payLine({ staffId: A, name: "Ana", role: "Stylist" }, refunded, null)).toMatchObject({ serviceCommissionCents: -900, retailCommissionCents: -75, minutes: null, hourlyPayCents: 0 });
  });

  it("pays hours at the rate in effect each day", () => {
    const schedule = { weekly: { 1: [{ start: 540, end: 1020 }], 2: [{ start: 540, end: 1020 }] }, overrides: {}, timeOff: [] };
    // $18/h, then $20/h from Tuesday the 13th; hourly only from the start.
    const history = [
      { from: null, hourlyRateCents: 1800 },
      { from: "2026-10-13", hourlyRateCents: 2000 },
    ];
    // Mon 5th, Tue 6th, Mon 12th at $18; Tue 13th at $20 (8h each).
    expect(hourlyPay(schedule, "2026-10-05", "2026-10-13", history)).toEqual({ minutes: 4 * 480, payCents: 3 * 8 * 1800 + 8 * 2000, rates: [1800, 2000] });
    expect(rateOn(history, "2026-10-12")).toBe(1800);
    // Moved to commission on the 13th: only the days before are hourly.
    expect(hourlyPay(schedule, "2026-10-05", "2026-10-13", [history[0], { from: "2026-10-13", hourlyRateCents: null }])).toEqual({ minutes: 3 * 480, payCents: 3 * 8 * 1800, rates: [1800] });
    expect(hourlyPay(schedule, "2026-10-05", "2026-10-13", [{ from: null, hourlyRateCents: null }])).toBeNull();
  });

  it("counts scheduled hours: one-off changes over weekly hours, less approved time off", () => {
    const schedule = {
      // Mondays and Tuesdays 9 to 5, with an hour off at lunch on Tuesdays.
      weekly: { 1: [{ start: 540, end: 1020 }], 2: [{ start: 540, end: 720 }, { start: 780, end: 1020 }] },
      // Monday the 12th is a short day.
      overrides: { "2026-10-12": [{ start: 540, end: 720 }] },
      timeOff: [
        { startsOn: "2026-10-13", endsOn: "2026-10-13", startMinute: 540, endMinute: 600, status: "approved" as const },
        { startsOn: "2026-10-05", endsOn: "2026-10-05", status: "requested" as const },
      ],
    };
    // Mon 5th 8h, Tue 6th 7h, Mon 12th 3h, Tue 13th 7h less 1h.
    expect(scheduledMinutes(schedule, "2026-10-05", "2026-10-13")).toBe((8 + 7 + 3 + 6) * 60);
    expect(scheduledMinutes(schedule, "2026-10-14", "2026-10-13")).toBe(0);
  });

  it("exports a row per person in dollars, safe for spreadsheets", () => {
    const pay = payLine({ staffId: A, name: '=Evil "Ana", Jr', role: "Stylist" }, ticketsFor([sale()], A, from, to), { minutes: 450, payCents: 13500, rates: [1800] });
    const csv = payrollCsv([pay], { from: "2026-10-05", to: "2026-10-18" });
    const [header, row] = csv.trimEnd().split("\r\n");
    expect(header).toBe(
      "Period start,Period end,Staff,Role,Service sales,Service commission %,Service commission,Retail sales,Retail commission %,Retail commission,Tips,Average tip %,Hours,Hourly rate,Hourly pay,Back-bar fees,Booth rent,Plan,Total pay",
    );
    expect(row).toBe(`2026-10-05,2026-10-18,"'=Evil ""Ana"", Jr",Stylist,80.00,45,36.00,20.00,15,3.00,10.00,12.5,7.5,18.00,135.00,0.00,0.00,,184.00`);
  });
});

describe("the period a page asks for", () => {
  it("takes sensible dates, else the last completed period", () => {
    expect(requestedPeriod({ from: "2026-10-01", to: "2026-10-09" }, "biweekly", "2026-01-05", "2026-10-23")).toEqual({ from: "2026-10-01", to: "2026-10-09" });
    for (const bad of [{}, { from: "2026-10-09", to: "2026-10-01" }, { from: "2024-01-01", to: "2026-10-01" }, { from: "nope", to: "2026-10-01" }]) {
      expect(requestedPeriod(bad, "biweekly", "2026-01-05", "2026-10-23")).toEqual({ from: "2026-09-28", to: "2026-10-11" });
    }
    expect(requestedPeriod({}, "custom", "2026-01-05", "2026-10-23")).toEqual({ from: "2026-10-01", to: "2026-10-23" });
  });
});
