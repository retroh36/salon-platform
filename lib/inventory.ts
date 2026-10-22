// Products and stock: amounts, values, low stock, filters, permissions and
// the product form. Pure, so pages, server actions and tests share them.
//
// Amounts are in the product's unit: grams or ml for back-bar products used
// by weight or volume (so partly used tubes count), units for retail.
// `size` is one container: a 60 g tube, a 1000 ml bottle, 1 unit.

import type { Enums } from "@/lib/database.types";
import type { StaffRole } from "@/lib/staff";

export type ProductType = Enums<"product_type">;
export type ProductUnit = Enums<"product_unit">;
export type StockReason = Enums<"stock_reason">;

export const TYPE_LABELS: Record<ProductType, string> = { retail: "Retail", back_bar: "Back bar" };
export const UNIT_LABELS: Record<ProductUnit, string> = { g: "grams", ml: "ml", unit: "units" };
export const REASON_LABELS: Record<StockReason, string> = {
  service_use: "Service use",
  sale: "Sale",
  count: "Count",
  order_received: "Order received",
  adjustment: "Adjustment",
};

// Owners and managers manage everything; the front desk sells retail and
// receives orders; stylists record formulas and view stock. The database
// enforces the same.
export function canManageInventory(role: StaffRole): boolean {
  return role === "owner" || role === "manager";
}
export function canSellRetail(role: StaffRole): boolean {
  return canManageInventory(role) || role === "front_desk";
}
export const canReceiveOrders = canSellRetail;

export type ProductLike = { brand: string; line: string | null; name: string; unit: ProductUnit; size: number };

// "Goldwell Topchic 7N"
export function productName(p: Pick<ProductLike, "brand" | "line" | "name">): string {
  return [p.brand, p.line, p.name].filter(Boolean).join(" ");
}

// What one container is called.
export function containerName(p: Pick<ProductLike, "unit" | "size">, plural = false): string {
  const word = p.unit === "unit" ? "unit" : p.unit === "g" ? (p.size <= 100 ? "tube" : "tub") : "bottle";
  return plural ? `${word}s` : word;
}

const trim = (n: number) => String(Math.round(n * 100) / 100);

// "60 g", "1,000 ml", "3 units"
export function formatAmount(amount: number, unit: ProductUnit): string {
  const n = Math.round(amount * 100) / 100;
  const text = Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : trim(n);
  if (unit === "unit") return `${text} ${Math.abs(n) === 1 ? "unit" : "units"}`;
  return `${text} ${unit}`;
}

// "144 g" with "2.4 tubes" beside it; retail is just "8 units".
export function describeStock(onHand: number, p: Pick<ProductLike, "unit" | "size">): { main: string; containers: string | null } {
  if (p.unit === "unit") return { main: formatAmount(onHand, "unit"), containers: null };
  const count = Math.round((onHand / p.size) * 10) / 10;
  return { main: formatAmount(onHand, p.unit), containers: `${trim(count)} ${containerName(p, count !== 1)}` };
}

// What the stock on hand cost, in cents (nothing for below zero).
export function stockValueCents(onHand: number, p: { size: number; cost_cents: number }): number {
  return Math.round((Math.max(onHand, 0) / p.size) * p.cost_cents);
}

// Low stock: below its reorder point.
export function isLow(onHand: number, reorderPoint: number): boolean {
  return reorderPoint > 0 && onHand < reorderPoint;
}

export type InventoryRow = {
  id: string;
  brand: string;
  line: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  type: ProductType;
  unit: ProductUnit;
  size: number;
  cost_cents: number;
  on_hand: number;
  reorder_point: number;
};

export type InventoryFilter = { q: string; brand: string | null; type: ProductType | null; low: boolean };

export function readFilter(params: Record<string, string | string[] | undefined>): InventoryFilter {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const type = one("type");
  return {
    q: one("q").slice(0, 100),
    brand: one("brand") || null,
    type: type === "retail" || type === "back_bar" ? type : null,
    low: one("low") === "1",
  };
}

// Search by brand, line, name, SKU or barcode (every word must match), and
// filter by brand, type and low stock.
export function filterInventory<T extends InventoryRow>(rows: readonly T[], f: InventoryFilter): T[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (f.brand && r.brand !== f.brand) return false;
    if (f.type && r.type !== f.type) return false;
    if (f.low && !isLow(r.on_hand, r.reorder_point)) return false;
    const haystack = `${productName(r)} ${r.sku ?? ""} ${r.barcode ?? ""}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

// The query string for a filter, for links.
export function filterQuery(f: InventoryFilter): string {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.brand) params.set("brand", f.brand);
  if (f.type) params.set("type", f.type);
  if (f.low) params.set("low", "1");
  const s = params.toString();
  return s ? `?${s}` : "";
}

// "12.50" -> 1250; null if it isn't money.
export function parseMoney(value: string): number | null {
  const v = value.trim().replace(/^\$/, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

// A positive amount with up to two decimals; null if not.
export function parseAmount(value: string): number | null {
  const v = value.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

export type ProductInput = {
  supplier_id: string | null;
  brand: string;
  line: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  type: ProductType;
  unit: ProductUnit;
  size: number;
  cost_cents: number;
  price_cents: number | null;
  shelf: string | null;
};

export type ProductField = "brand" | "name" | "sku" | "barcode" | "type" | "unit" | "size" | "cost" | "price" | "shelf";
export type ProductFormErrors = Partial<Record<ProductField, string>>;

export function parseProductForm(form: FormData): { ok: true; value: ProductInput } | { ok: false; errors: ProductFormErrors } {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const optional = (k: string) => text(k) || null;
  const errors: ProductFormErrors = {};

  const brand = text("brand");
  if (!brand) errors.brand = "Enter the brand.";
  else if (brand.length > 100) errors.brand = "Keep it under 100 characters.";
  const name = text("name");
  if (!name) errors.name = "Enter the shade or product name.";
  else if (name.length > 200) errors.name = "Keep it under 200 characters.";
  const sku = optional("sku");
  if (sku && sku.length > 100) errors.sku = "Keep it under 100 characters.";
  const barcode = optional("barcode");
  if (barcode && !/^\d{6,14}$/.test(barcode)) errors.barcode = "Use the 6 to 14 digits under the barcode.";

  const type = text("type");
  if (type !== "retail" && type !== "back_bar") errors.type = "Choose retail or back bar.";
  const unit = text("unit");
  if (unit !== "g" && unit !== "ml" && unit !== "unit") errors.unit = "Choose grams, ml or units.";

  let size = unit === "unit" ? 1 : parseAmount(text("size"));
  if (size === null) errors.size = "Enter how much one container holds, e.g. 60.";
  const cost = parseMoney(text("cost"));
  if (cost === null) errors.cost = "Enter the cost, e.g. 9.50.";
  let price: number | null = null;
  if (type === "retail") {
    price = parseMoney(text("price"));
    if (price === null) errors.price = "Enter the retail price.";
  }
  if (type === "retail" && unit !== "unit") errors.unit = "Retail products are sold in units.";
  const shelf = optional("shelf");
  if (shelf && shelf.length > 100) errors.shelf = "Keep it under 100 characters.";
  size ??= 1;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      supplier_id: optional("supplier_id"),
      brand,
      line: optional("line"),
      name,
      sku,
      barcode,
      type: type as ProductType,
      unit: unit as ProductUnit,
      size,
      cost_cents: cost!,
      price_cents: price,
      shelf,
    },
  };
}
