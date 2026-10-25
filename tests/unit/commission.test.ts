import { describe, expect, it } from "vitest";
import {
  backbarFee,
  nextTierText,
  parseRules,
  payLines,
  planSummary,
  rentFor,
  rulesJson,
  tierAt,
  tieredCommission,
  type PayInput,
  type PlanRules,
} from "@/lib/commission";
import { payLine, planContext, ticketsFor, windowsFrom, periodContaining, type PayrollSale, type PlanVersion } from "@/lib/payroll";

const TIERS = [
  { fromCents: 0, pct: 40 },
  { fromCents: 400_000, pct: 45 },
  { fromCents: 800_000, pct: 50 },
];
const plan = (over: Partial<PlanRules> = {}): PlanRules => ({
  mode: "commission",
  service: TIERS,
  retail: [{ fromCents: 0, pct: 10 }],
  tierPeriod: "month",
  backbar: { kind: "none" },
  rent: null,
  ...over,
});
const line = (at: string, cents: number, over: Partial<PayInput> = {}): PayInput => ({ at, kind: "service", cents, soldCents: cents, quantity: 1, pct: 0, versionId: "v1", ...over });
const byMonth = (at: string) => at.slice(0, 7);

describe("tiers", () => {
  it("pays each dollar at the rate of its tier, never a cliff", () => {
    expect(tieredCommission(TIERS, 300_000)).toBe(120_000);
    expect(tieredCommission(TIERS, 500_000)).toBe(160_000 + 45_000);
    expect(tieredCommission(TIERS, 1_000_000)).toBe(160_000 + 180_000 + 100_000);
    expect(tieredCommission(TIERS, -10_000)).toBe(-4_000);
  });

  it("says where someone is and how far the next tier is", () => {
    expect(tierAt(TIERS, 358_800)).toEqual({ pct: 40, next: { pct: 45, neededCents: 41_200 } });
    expect(tierAt(TIERS, 900_000)).toEqual({ pct: 50, next: null });
    expect(nextTierText("service", plan(), 358_800)).toBe("You're $412 from 45% on services (this month).");
    expect(nextTierText("service", plan(), 900_000)).toBeNull();
    expect(nextTierText("service", plan({ mode: "hourly" }), 0)).toBeNull();
  });

  it("crossing a tier splits that sale between the two rates", () => {
    const [a, b] = payLines([line("2026-10-02", 390_000), line("2026-10-03", 20_000)], () => plan(), byMonth);
    expect(a.commissionCents).toBe(156_000);
    expect(b.commissionCents).toBe(10_000 * 0.4 + 10_000 * 0.45);
    expect(b.pct).toBe(42.5);
  });

  it("starts again each month, counting what was sold earlier that month", () => {
    const lines = [line("2026-10-30", 100_000), line("2026-11-01", 100_000)];
    const [oct, nov] = payLines(lines, () => plan(), byMonth, (w) => ({ service: w === "2026-10" ? 350_000 : 0, product: 0 }));
    expect(oct.commissionCents).toBe(50_000 * 0.4 + 50_000 * 0.45);
    expect(nov.commissionCents).toBe(40_000);
  });

  it("a refund takes back at the rate those dollars earned", () => {
    const [sale, refund] = payLines([line("2026-10-02", 450_000), line("2026-10-05", -50_000)], () => plan(), byMonth);
    expect(sale.commissionCents + refund.commissionCents).toBe(160_000);
    expect(refund.commissionCents).toBe(-22_500);
  });

  it("lines without a plan keep their own recorded rate", () => {
    expect(payLines([line("2026-10-02", 10_000, { versionId: null, pct: 45 })], () => plan(), byMonth)[0]).toEqual({ feeCents: 0, commissionCents: 4_500, pct: 45 });
  });
});

describe("deductions and modes", () => {
  it("takes the back-bar fee off a service before commission", () => {
    expect(backbarFee({ kind: "fixed", cents: 300 }, 10_000, 1)).toBe(300);
    expect(backbarFee({ kind: "fixed", cents: 300 }, 200, 1)).toBe(200);
    expect(backbarFee({ kind: "percent", pct: 5 }, 10_000, 1)).toBe(500);
    const [pay] = payLines([line("2026-10-02", 10_000)], () => plan({ backbar: { kind: "fixed", cents: 300 } }), byMonth);
    expect(pay).toMatchObject({ feeCents: 300, commissionCents: 3_880 });
    // Retail never has a back-bar fee.
    expect(payLines([line("2026-10-02", 5_000, { kind: "product" })], () => plan({ backbar: { kind: "fixed", cents: 300 } }), byMonth)[0]).toMatchObject({ feeCents: 0, commissionCents: 500 });
  });

  it("a refund takes back its share of the fee", () => {
    const [, refund] = payLines([line("2026-10-02", 10_000), line("2026-10-03", -5_000, { soldCents: 10_000 })], () => plan({ backbar: { kind: "fixed", cents: 300 } }), byMonth);
    expect(refund).toMatchObject({ feeCents: -150, commissionCents: -1_940 });
  });

  it("hourly pays no service commission; booth renters keep their sales less the fee", () => {
    expect(payLines([line("2026-10-02", 10_000)], () => plan({ mode: "hourly" }), byMonth)[0]).toMatchObject({ feeCents: 0, commissionCents: 0 });
    expect(payLines([line("2026-10-02", 5_000, { kind: "product" })], () => plan({ mode: "hourly" }), byMonth)[0].commissionCents).toBe(500);
    const booth = plan({ mode: "booth_rent", rent: { cents: 60_000, per: "week" }, backbar: { kind: "percent", pct: 5 } });
    expect(payLines([line("2026-10-02", 10_000)], () => booth, byMonth)[0]).toMatchObject({ feeCents: 500, commissionCents: 9_500 });
  });

  it("works out rent by the day", () => {
    expect(rentFor(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"], () => ({ cents: 70_000, per: "week" }))).toBeCloseTo(70_000);
    // A month's rent over its own days: all of February, then a day of March.
    const feb = Array.from({ length: 28 }, (_, i) => `2026-02-${String(i + 1).padStart(2, "0")}`);
    expect(rentFor([...feb, "2026-03-01"], () => ({ cents: 155_000, per: "month" }))).toBeCloseTo(155_000 + 5_000);
    expect(rentFor(feb, () => null)).toBe(0);
  });

  it("reads and writes the stored shape, and describes a plan", () => {
    const rules = plan({ backbar: { kind: "fixed", cents: 300 } });
    expect(parseRules(JSON.parse(JSON.stringify(rulesJson(rules))))).toEqual(rules);
    expect(planSummary(rules)).toBe("Services 40% to $4,000, 45% to $8,000, then 50%; retail 10%, $3 back-bar fee per service; tiers start again each month");
    expect(planSummary(plan({ mode: "booth_rent", rent: { cents: 120_000, per: "month" } }))).toBe("Booth rent: $1,200 a month; keeps their sales");
  });
});

describe("payroll pays plan lines the same way", () => {
  const A = "a0000000-0000-4000-8000-000000000001";
  const versions: PlanVersion[] = [{ id: "v1", planId: "p1", name: "Stylist tiers", rules: plan({ backbar: { kind: "fixed", cents: 300 } }), createdAt: "2026-01-01T00:00:00Z" }];
  const sale = (id: string, at: string, cents: number): PayrollSale => ({
    id,
    number: 1,
    created_at: at,
    total_cents: cents,
    voided_at: null,
    client: "Ava B",
    lines: [{ kind: "service", staff_id: A, description: "Color", quantity: 1, net_cents: cents, commission_pct: 40, commission_version_id: "v1" }],
    tips: [{ staff_id: A, amount_cents: 1_000 }],
    refunds: [],
  });
  const periodOf = (d: string) => periodContaining("semi_monthly", "2026-01-05", d);
  const dayOf = (iso: string) => iso.slice(0, 10);

  it("counts the month's earlier sales toward the tiers, and takes off fees and rent", () => {
    const sales = [sale("s1", "2026-10-10T15:00:00Z", 390_000), sale("s2", "2026-10-20T15:00:00Z", 20_000)];
    const period = { from: "2026-10-16", to: "2026-10-31" };
    const earliest = windowsFrom(period, periodOf);
    expect(earliest).toBe("2026-10-01");
    const context = planContext({
      versions,
      dayOf,
      periodOf,
      before: ticketsFor(sales, A, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-16T00:00:00Z")),
    });
    const pay = payLine({ staffId: A, name: "Ana", role: "Stylist" }, ticketsFor(sales, A, new Date("2026-10-16T00:00:00Z"), new Date("2026-11-01T00:00:00Z")), null, context);
    // $200 at 42.5% (half each side of $4,000), less its $3 fee's share.
    expect(pay).toMatchObject({ serviceCents: 20_000, feeCents: 300, serviceCommissionCents: Math.round(8_500 * (19_700 / 20_000)), tipCents: 1_000 });
    expect(pay.rates.plans).toEqual(["Stylist tiers"]);
    expect(pay.tickets[0].lines[0].pay).toMatchObject({ feeCents: 300, pct: 42.5 });
  });

  it("charges booth rent for the days they rented", () => {
    const booth: PlanVersion[] = [{ id: "v2", planId: "p2", name: "Booth", rules: plan({ mode: "booth_rent", rent: { cents: 70_000, per: "week" } }), createdAt: "2026-01-01T00:00:00Z" }];
    const context = planContext({ versions: booth, dayOf, periodOf, rentDays: ["2026-10-01", "2026-10-02", "2026-10-03"], planOn: (d) => (d >= "2026-10-02" ? "p2" : null) });
    const pay = payLine({ staffId: A, name: "Ana", role: "Stylist" }, [], null, context);
    expect(pay).toMatchObject({ rentCents: 20_000, totalCents: -20_000 });
  });
});
