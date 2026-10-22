import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { containerName, productName } from "@/lib/inventory";
import type { OrderProduct } from "./order-editor";

// Products to order, with their supplier and cost.
export async function orderProducts(supabase: SupabaseClient<Database>): Promise<OrderProduct[]> {
  const { data, error } = await supabase.from("products").select("id, brand, line, name, unit, size, supplier_id, cost_cents").eq("is_active", true);
  if (error) throw error;
  return data
    .map((p) => ({
      id: p.id,
      label: p.unit === "unit" ? productName(p) : `${productName(p)} (${p.size} ${p.unit})`,
      supplierId: p.supplier_id,
      costCents: p.cost_cents,
      container: containerName(p),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
}
