// Loads the usage report for a period (lib/usage-report.ts): every product
// with its stock here and what's on order, and what moved out in the period
// and in the one it's compared with (product_usage), read with the
// person's own login so RLS decides.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadInventory } from "@/lib/inventory-load";
import { productName } from "@/lib/inventory";
import { toLocal } from "@/lib/scheduling/time";
import { compareWith, usageRows, type Compared, type UsageProduct, type UsageRow, type UsageTotal } from "@/lib/usage-report";

type Supabase = SupabaseClient<Database>;

async function usage(supabase: Supabase, locationId: string, from: string, to: string): Promise<UsageTotal[]> {
  const { data, error } = await supabase.rpc("product_usage", { p_location_id: locationId, p_from: from, p_to: to });
  if (error) throw error;
  return data.flatMap((r) => (r.reason === "service_use" || r.reason === "sale" ? [{ productId: r.product_id, reason: r.reason, change: Number(r.change) }] : []));
}

export async function loadUsageReport(
  supabase: Supabase,
  location: { id: string; timezone: string },
  period: { from: string; to: string },
): Promise<{ rows: UsageRow[]; compared: Compared }> {
  const [rows, orders, first, current] = await Promise.all([
    loadInventory(supabase, location.id, { includeInactive: true }),
    supabase
      .from("purchase_orders")
      .select("purchase_order_lines(product_id, quantity, received_quantity)")
      .eq("location_id", location.id)
      .in("status", ["sent", "partly_received"]),
    supabase.from("stock_movements").select("created_at").eq("location_id", location.id).order("created_at").limit(1).maybeSingle(),
    usage(supabase, location.id, period.from, period.to),
  ]);
  if (orders.error) throw orders.error;
  if (first.error) throw first.error;
  const compared = compareWith(period, first.data ? toLocal(new Date(first.data.created_at), location.timezone).date : null);
  const earlier = await usage(supabase, location.id, compared.from, compared.to);

  const size = new Map(rows.map((r) => [r.id, r.size]));
  const onOrder = new Map<string, number>();
  for (const l of orders.data.flatMap((o) => o.purchase_order_lines)) {
    onOrder.set(l.product_id, (onOrder.get(l.product_id) ?? 0) + (l.quantity - l.received_quantity) * (size.get(l.product_id) ?? 0));
  }
  const products: UsageProduct[] = rows.map((r) => ({
    productId: r.id,
    name: productName(r),
    type: r.type,
    unit: r.unit,
    supplierId: r.supplier?.id ?? null,
    onHand: r.on_hand,
    onOrder: onOrder.get(r.id) ?? 0,
    reorderPoint: r.reorder_point,
    reorderQuantity: r.reorder_quantity,
    size: r.size,
    costCents: r.cost_cents,
  }));
  return { rows: usageRows(products, current, earlier), compared };
}
