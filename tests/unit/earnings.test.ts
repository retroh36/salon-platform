import { describe, expect, it } from "vitest";
import type { PlanRules } from "@/lib/commission";
import { currentRate, estimates, totalsBetween, windowBasis } from "@/lib/earnings";
import { payLine, ticketsFor, type PayrollSale } from "@/lib/payroll";

const A = "a0000000-0000-4000-8000-000000000001";
const RULES: PlanRules = {
  mode: "commission",
  service: [
    { fromCents: 0, pct: 40 },
    { fromCents: 400_000, pct: 45 },
  ],
  retail: [{ fromCents: 0, pct: 10 }],
  tierPeriod: "month",
  tierStyle: "marginal",
  backbar: { kind: "fixed", cents: 300 },
};
const sale = (id: string, at: string, cents: number, tip: number): PayrollSale => ({
  id,
  number: 1,
  created_at: at,
  total_cents: cents + tip,
  voided_at: null,
  client: "Ava Brooks",
  lines: [{ kind: "service", staff_id: A, description: "Color", quantity: 1, net_cents: cents, commission_pct: 40, commission_version_id: "v1" }],
  tips: [{ staff_id: A, amount_cents: tip }],
  refunds: [],
});
const dayOf = (iso: string) => iso.slice(0, 10);
const byMonth = (at: string) => `month:${at.slice(0, 7)}-01`;

describe("live earnings", () => {
  const sales = [sale("s1", "2026-10-19T15:00:00Z", 390_000, 0), sale("s2", "2026-10-23T15:00:00Z", 20_000, 4_000)];
  const pay = payLine({ staffId: A, name: "Ana", role: "Stylist" }, ticketsFor(sales, A, new Date("2026-10-01"), new Date("2026-11-01")), null, {
    rulesFor: () => RULES,
    windowOf: byMonth,
  });

  it("adds up today, the week and the period from payroll's own lines", () => {
    const today = totalsBetween(pay.tickets, "2026-10-23", "2026-10-23", dayOf);
    expect(today).toEqual({ salesCents: 20_000, feeCents: 300, commissionCents: Math.round(8_500 * 0.985), tipCents: 4_000, earnedCents: Math.round(8_500 * 0.985) + 4_000 });
    const period = totalsBetween(pay.tickets, "2026-10-01", "2026-10-31", dayOf);
    expect(period.commissionCents).toBe(pay.serviceCommissionCents);
    expect(period.feeCents).toBe(pay.feeCents);
  });

  it("estimates visits in the chair after what's sold, crossing tiers like a sale would", () => {
    const basis = windowBasis(pay.tickets, () => RULES, byMonth, "month:2026-10-01");
    expect(basis).toEqual({ service: 410_000, product: 0 });
    expect(currentRate(RULES, basis)).toBe(45);
    const [e] = estimates([{ itemId: "i1", service: "Cut", client: "Ava", priceCents: 10_000 }], { rules: RULES, basis, at: "2026-10-23T18:00:00Z" });
    expect(e).toMatchObject({ feeCents: 300, commissionCents: Math.round(4_500 * 0.97) });
    // Off a plan: their own service rate.
    expect(estimates([{ itemId: "i1", service: "Cut", client: "Ava", priceCents: 10_000 }], { ownPct: 35 })[0].commissionCents).toBe(3_500);
  });
});
