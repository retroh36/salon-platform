// Loading products with their stock at a location.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { InventoryRow } from "./inventory";

type Supabase = SupabaseClient<Database>;

export type StockRow = InventoryRow & {
  line: string | null;
  price_cents: number | null;
  shelf: string | null;
  is_active: boolean;
  supplier: { id: string; name: string } | null;
  reorder_quantity: number;
};

// Every product (active first, by brand, line and name) with its stock here.
export async function loadInventory(supabase: Supabase, locationId: string, { includeInactive = false } = {}): Promise<StockRow[]> {
  let query = supabase
    .from("products")
    .select(
      "id, brand, line, name, sku, barcode, type, unit, size, cost_cents, price_cents, shelf, is_active, supplier:suppliers(id, name), stock_levels(location_id, on_hand, reorder_point, reorder_quantity)",
    )
    .order("brand")
    .order("line", { nullsFirst: true })
    .order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  // Shades in natural order: 4N before 10N.
  const order = (p: { brand: string; line: string | null; name: string }) => [p.brand, p.line ?? "", p.name].join("\u0000");
  data.sort((a, b) => order(a).localeCompare(order(b), "en", { numeric: true, sensitivity: "base" }));
  return data.map(({ stock_levels, ...p }) => {
    const level = stock_levels.find((l) => l.location_id === locationId);
    return { ...p, on_hand: level?.on_hand ?? 0, reorder_point: level?.reorder_point ?? 0, reorder_quantity: level?.reorder_quantity ?? 1 };
  });
}
