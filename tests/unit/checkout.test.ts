import { describe, expect, it } from "vitest";
import { computeSale, discountAllowed, discountLimitWarning, discountCents, formatRate, parseDollars, paymentStatus, priceLines } from "@/lib/checkout";

// Who's giving a discount: the front desk has a limit; managers (and
// anyone an owner allowed) can give big discounts.
const DESK = { role: "front_desk", permissions: [] };
const MANAGER = { role: "manager", permissions: ["big_discounts"] };
const service = (cents: number, taxBp = 0) => ({ grossCents: cents, taxBp, discountable: true });
const retail = (cents: number, taxBp = 1025) => ({ grossCents: cents, taxBp, discountable: true });

describe("a sale's total", () => {
  it("adds services, retail, tax on retail, and tips", () => {
    const t = computeSale([service(10000), retail(3200)], null, [1500]);
    // 10.25% of $32 is $3.28.
    expect(t).toMatchObject({ subtotalCents: 13200, discountCents: 0, taxCents: 328, tipCents: 1500, totalCents: 15028 });
    expect(t.lines).toEqual([
      { discountCents: 0, taxCents: 0, totalCents: 10000 },
      { discountCents: 0, taxCents: 328, totalCents: 3528 },
    ]);
  });

  it("shares a discount across lines in proportion, before tax, with leftover cents going to the first lines", () => {
    // $10 off $100 + $32: $7.57 and $2.42, plus the leftover cent to the first.
    const t = computeSale([service(10000), retail(3200)], { kind: "amount", value: 1000 }, []);
    expect(t.lines.map((l) => l.discountCents)).toEqual([758, 242]);
    expect(t.discountCents).toBe(1000);
    // Tax on $29.58 retail: $3.03.
    expect(t.taxCents).toBe(303);
    expect(t.totalCents).toBe(13200 - 1000 + 303);
    // Three equal lines and 2 cents: one each to the first two.
    expect(priceLines([service(100), service(100), service(100)], 2).map((l) => l.discountCents)).toEqual([1, 1, 0]);
  });

  it("works out percentages, and never discounts more than the sale", () => {
    expect(discountCents([service(8500), retail(3333)], { kind: "percent", value: 15 })).toBe(1775);
    expect(discountCents([service(5000)], { kind: "percent", value: 150 })).toBe(5000);
    expect(discountCents([service(5000)], { kind: "amount", value: 9000 })).toBe(5000);
    expect(discountCents([service(5000)], { kind: "amount", value: 0 })).toBe(0);
    // Lines a discount doesn't apply to keep their price.
    expect(priceLines([service(5000), { grossCents: 2500, taxBp: 0, discountable: false }], 500).map((l) => l.discountCents)).toEqual([500, 0]);
  });
});

describe("payments", () => {
  it("tracks what's due across split tenders, and cash change", () => {
    expect(paymentStatus(15028, [{ method: "card", amountCents: 10000 }])).toEqual({ paidCents: 10000, dueCents: 5028, changeCents: 0, settled: false });
    expect(paymentStatus(15028, [{ method: "card", amountCents: 10000 }, { method: "cash", amountCents: 5028, tenderedCents: 6000 }])).toEqual({ paidCents: 15028, dueCents: 0, changeCents: 972, settled: true });
    expect(paymentStatus(1000, [{ method: "card", amountCents: 1500 }]).dueCents).toBe(-500);
  });
});

describe("who may discount", () => {
  const settings = { roles: ["owner", "manager", "front_desk"], maxPercent: 10 };
  it("allows the salon's roles, within its limit for the front desk", () => {
    expect(discountAllowed(DESK, settings, 1000, 10000)).toEqual({ ok: true });
    expect(discountAllowed(DESK, settings, 1001, 10000)).toEqual({ ok: false, message: "You can give up to 10% off. Ask a manager for more." });
    expect(discountAllowed(MANAGER, settings, 5000, 10000)).toEqual({ ok: true });
    expect(discountAllowed(DESK, { ...settings, roles: ["owner"] }, 100, 10000)).toMatchObject({ ok: false });
    expect(discountAllowed(DESK, { ...settings, roles: ["owner"] }, 0, 10000)).toEqual({ ok: true });
  });

  it("warns only the front desk about the percent limit", () => {
    expect(discountLimitWarning(DESK, "percent", 15, 10)).toBe("You can give up to 10% off. Ask a manager for more.");
    expect(discountLimitWarning(DESK, "percent", 10, 10)).toBeNull();
    // A front desk the owner trusts with big discounts.
    expect(discountLimitWarning({ role: "front_desk", permissions: ["big_discounts"] }, "percent", 50, 10)).toBeNull();
    expect(discountAllowed({ role: "front_desk", permissions: ["big_discounts"] }, { roles: ["owner", "manager", "front_desk"], maxPercent: 10 }, 5000, 10000)).toEqual({ ok: true });
    expect(discountLimitWarning(MANAGER, "percent", 50, 10)).toBeNull();
    expect(discountLimitWarning(MANAGER, "percent", 100, 10)).toBeNull();
  });
});

describe("amounts typed in", () => {
  it("reads dollars and rates", () => {
    expect(parseDollars("12")).toBe(1200);
    expect(parseDollars("$1,250.5")).toBe(125050);
    expect(parseDollars("12.345")).toBeNull();
    expect(parseDollars("-3")).toBeNull();
    expect(formatRate(1025)).toBe("10.25%");
    expect(formatRate(800)).toBe("8%");
  });
});
