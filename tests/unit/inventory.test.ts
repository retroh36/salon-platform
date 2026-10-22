import { describe, expect, it } from "vitest";
import {
  canManageInventory,
  canReceiveOrders,
  canSellRetail,
  containerName,
  describeStock,
  filterInventory,
  filterQuery,
  formatAmount,
  isLow,
  parseAmount,
  parseMoney,
  parseProductForm,
  productName,
  readFilter,
  stockValueCents,
  type InventoryRow,
} from "@/lib/inventory";

const tube = { unit: "g" as const, size: 60 };
const row = (o: Partial<InventoryRow>): InventoryRow => ({
  id: "p",
  brand: "Goldwell",
  line: "Topchic",
  name: "7N",
  sku: "GW-TC-7N",
  barcode: "200000000017",
  type: "back_bar",
  unit: "g",
  size: 60,
  cost_cents: 950,
  on_hand: 144,
  reorder_point: 180,
  ...o,
});

describe("amounts", () => {
  it("names products and containers", () => {
    expect(productName({ brand: "Goldwell", line: "Topchic", name: "7N" })).toBe("Goldwell Topchic 7N");
    expect(productName({ brand: "Olaplex", line: null, name: "No.3" })).toBe("Olaplex No.3");
    expect(containerName(tube)).toBe("tube");
    expect(containerName({ unit: "g", size: 800 }, true)).toBe("tubs");
    expect(containerName({ unit: "ml", size: 1000 }, true)).toBe("bottles");
  });

  it("shows partly used tubes exactly, with the container count", () => {
    expect(describeStock(144, tube)).toEqual({ main: "144 g", containers: "2.4 tubes" });
    expect(describeStock(60, tube)).toEqual({ main: "60 g", containers: "1 tube" });
    expect(describeStock(2300, { unit: "ml", size: 1000 })).toEqual({ main: "2,300 ml", containers: "2.3 bottles" });
    expect(describeStock(8, { unit: "unit", size: 1 })).toEqual({ main: "8 units", containers: null });
    expect(formatAmount(1, "unit")).toBe("1 unit");
    expect(formatAmount(-12.5, "g")).toBe("-12.5 g");
  });

  it("values stock at cost per container, ignoring anything below zero", () => {
    expect(stockValueCents(144, { size: 60, cost_cents: 950 })).toBe(2280);
    expect(stockValueCents(-30, { size: 60, cost_cents: 950 })).toBe(0);
    expect(stockValueCents(8, { size: 1, cost_cents: 1500 })).toBe(12000);
  });

  it("is low below the reorder point, never without one", () => {
    expect(isLow(144, 180)).toBe(true);
    expect(isLow(180, 180)).toBe(false);
    expect(isLow(0, 0)).toBe(false);
  });
});

describe("filtering", () => {
  const rows = [
    row({ id: "a" }),
    row({ id: "b", name: "8N", sku: "GW-TC-8N", on_hand: 240, reorder_point: 120 }),
    row({ id: "c", brand: "Olaplex", line: null, name: "No.3 Hair Perfector", type: "retail", unit: "unit", size: 1, sku: "OLX-3", barcode: "200000000099", on_hand: 9, reorder_point: 4 }),
  ];

  it("searches name, shade, SKU and barcode, every word", () => {
    expect(filterInventory(rows, readFilter({ q: "7n" })).map((r) => r.id)).toEqual(["a"]);
    expect(filterInventory(rows, readFilter({ q: "goldwell topchic" })).map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterInventory(rows, readFilter({ q: "OLX-3" })).map((r) => r.id)).toEqual(["c"]);
    expect(filterInventory(rows, readFilter({ q: "200000000099" })).map((r) => r.id)).toEqual(["c"]);
  });

  it("filters by brand, type and low stock", () => {
    expect(filterInventory(rows, readFilter({ brand: "Olaplex" })).map((r) => r.id)).toEqual(["c"]);
    expect(filterInventory(rows, readFilter({ type: "back_bar" })).map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterInventory(rows, readFilter({ low: "1" })).map((r) => r.id)).toEqual(["a"]);
    expect(readFilter({ type: "nonsense", low: "yes" })).toEqual({ q: "", brand: null, type: null, low: false });
  });

  it("round-trips to a query string", () => {
    const f = { q: "7n", brand: "Goldwell", type: "back_bar" as const, low: true };
    expect(filterQuery(f)).toBe("?q=7n&brand=Goldwell&type=back_bar&low=1");
    expect(readFilter(Object.fromEntries(new URLSearchParams(filterQuery(f).slice(1))))).toEqual(f);
    expect(filterQuery({ q: "", brand: null, type: null, low: false })).toBe("");
  });
});

describe("the product form", () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ brand: "Goldwell", line: "Topchic", name: "7N", type: "back_bar", unit: "g", size: "60", cost: "9.50", ...o })) f.set(k, v);
    return f;
  };

  it("reads a back-bar color", () => {
    expect(parseProductForm(form({}))).toEqual({
      ok: true,
      value: { supplier_id: null, brand: "Goldwell", line: "Topchic", name: "7N", sku: null, barcode: null, type: "back_bar", unit: "g", size: 60, cost_cents: 950, price_cents: null, shelf: null },
    });
  });

  it("needs a price for retail, sold in units", () => {
    expect(parseProductForm(form({ type: "retail", unit: "unit", price: "" }))).toEqual({ ok: false, errors: { price: "Enter the retail price." } });
    expect(parseProductForm(form({ type: "retail", unit: "ml", price: "30" }))).toMatchObject({ ok: false, errors: { unit: "Retail products are sold in units." } });
    expect(parseProductForm(form({ type: "retail", unit: "unit", price: "$30" }))).toMatchObject({ ok: true, value: { size: 1, price_cents: 3000 } });
  });

  it("checks every field", () => {
    const result = parseProductForm(form({ brand: "", name: "", type: "x", unit: "kg", size: "0", cost: "free", barcode: "12ab" }));
    expect(result.ok).toBe(false);
    expect(Object.keys(result.ok ? {} : result.errors).sort()).toEqual(["barcode", "brand", "cost", "name", "size", "type", "unit"]);
  });

  it("parses money and amounts", () => {
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("12.505")).toBeNull();
    expect(parseAmount("2.5")).toBe(2.5);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-3")).toBeNull();
  });
});

describe("permissions", () => {
  it("lets managers manage, the front desk sell and receive, stylists view", () => {
    expect(["owner", "manager", "front_desk", "stylist"].map((r) => [canManageInventory(r as never), canSellRetail(r as never), canReceiveOrders(r as never)])).toEqual([
      [true, true, true],
      [true, true, true],
      [false, true, true],
      [false, false, false],
    ]);
  });
});
