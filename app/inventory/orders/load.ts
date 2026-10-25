import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { containerName, productName } from "@/lib/inventory";
import { loadCosts } from "@/lib/inventory-load";
import type { OrderProduct } from "./order-editor";

// Products to order, with their supplier and cost.
export async function orderProducts(supabase: SupabaseClient<Database>): Promise<OrderProduct[]> {
  const [{ data, error }, costs] = await Promise.all([supabase.from("products").select("id, brand, line, name, unit, size, supplier_id").eq("is_active", true), loadCosts(supabase)]);
  if (error) throw error;
  return data
    .map((p) => ({
      id: p.id,
      label: p.unit === "unit" ? productName(p) : `${productName(p)} (${p.size} ${p.unit})`,
      supplierId: p.supplier_id,
      costCents: costs.get(p.id) ?? 0,
      container: containerName(p),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
}
