import { describe, expect, it } from "vitest";
import { compareWith, lastYear, usagePeriod, usageRows, usageSummary, type UsageProduct } from "@/lib/usage-report";

const product = (id: string, more: Partial<UsageProduct> = {}): UsageProduct => ({
  productId: id,
  name: id,
  type: "color",
  unit: "g",
  supplierId: "s",
  onHand: 120,
  onOrder: 0,
  reorderPoint: 60,
  reorderQuantity: 2,
  size: 60,
  costCents: 950,
  ...more,
});

describe("the period", () => {
  it("is the last 30 days by default, never past today, at most a year", () => {
    expect(usagePeriod({}, "2026-11-05")).toEqual({ from: "2026-10-07", to: "2026-11-05" });
    expect(usagePeriod({ from: "2026-10-01", to: "2026-12-01" }, "2026-11-05")).toEqual({ from: "2026-10-01", to: "2026-11-05" });
    expect(usagePeriod({ from: "2026-11-04", to: "2026-11-01" }, "2026-11-05")).toEqual({ from: "2026-11-01", to: "2026-11-01" });
    expect(usagePeriod({ from: "2020-01-01", to: "2026-11-05" }, "2026-11-05")).toEqual({ from: "2025-11-05", to: "2026-11-05" });
    expect(usagePeriod({ from: "nope", to: "2026-13-45" }, "2026-11-05")).toEqual({ from: "2026-10-07", to: "2026-11-05" });
  });

  it("compares with the same dates last year once there's history then, else the period before", () => {
    expect(lastYear("2028-02-29")).toBe("2027-02-28");
    const period = { from: "2026-10-07", to: "2026-11-05" };
    expect(compareWith(period, "2025-01-01")).toEqual({ kind: "last_year", from: "2025-10-07", to: "2025-11-05" });
    expect(compareWith(period, "2026-07-16")).toEqual({ kind: "previous", from: "2026-09-07", to: "2026-10-06" });
    expect(compareWith(period, null)).toEqual({ kind: "previous", from: "2026-09-07", to: "2026-10-06" });
  });
});

describe("the rows", () => {
  const products = [
    product("7N"),
    product("Shampoo", { type: "retail", unit: "unit", size: 1, onHand: 10, reorderPoint: 3, reorderQuantity: 6 }),
    product("6RR", { onHand: 600 }),
    product("Unused"),
  ];
  const rows = usageRows(
    products,
    [
      { productId: "7N", reason: "service_use", change: -300 },
      { productId: "Shampoo", reason: "sale", change: -9 },
      { productId: "Shampoo", reason: "sale", change: 1 },
      { productId: "6RR", reason: "service_use", change: -60 },
    ],
    [
      { productId: "7N", reason: "service_use", change: -200 },
      { productId: "Shampoo", reason: "sale", change: -10 },
    ],
  );

  it("sums used and sold (net of returns), most used first, leaving out what didn't move", () => {
    expect(rows.map((r) => [r.productId, r.used, r.sold, r.before, r.changePct])).toEqual([
      ["Shampoo", 0, 8, 10, -20],
      ["7N", 300, 0, 200, 50],
      ["6RR", 60, 0, 0, null],
    ]);
  });

  it("suggests an order to cover another period like it and stay above the reorder point", () => {
    // 7N: 120 g on hand, 300 g used: 300 + 60 − 120 = 240 g, 4 tubes.
    expect(rows.find((r) => r.productId === "7N")!.suggested).toBe(4);
    // Shampoo: 10 on hand, 8 sold: 8 + 3 − 10 = 1, but at least 6.
    expect(rows.find((r) => r.productId === "Shampoo")!.suggested).toBe(6);
    // 6RR has plenty.
    expect(rows.find((r) => r.productId === "6RR")!.suggested).toBe(0);
  });

  it("has Denise sum it up by type, with the biggest changes", () => {
    expect(usageSummary(rows, { kind: "last_year", from: "2025-10-07", to: "2025-11-05" }, "Oct 7 to Nov 5, 2025")).toBe(
      "Against the same dates last year (Oct 7 to Nov 5, 2025): color is up 80%, retail is down 20%. Biggest changes: 7N +50%, Shampoo −20%.",
    );
    expect(usageSummary(rows, { kind: "previous", from: "2026-09-07", to: "2026-10-06" }, "30 days")).toMatch(/^Against the 30 days before: color is up 80%, retail is down 20%\./);
    expect(usageSummary(usageRows(products, [{ productId: "7N", reason: "service_use", change: -60 }], []), { kind: "previous", from: "a", to: "b" }, "30 days")).toBeNull();
  });
});
