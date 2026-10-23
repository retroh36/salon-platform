"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { canManageInventory, parseAmount, parseProductForm, type ProductFormErrors } from "@/lib/inventory";

const MANAGERS_ONLY = "Only owners and managers can change products and stock.";

function refresh() {
  revalidatePath("/inventory", "layout");
}

export type ProductFormState = { errors: ProductFormErrors; message?: string; fields: Record<string, string> } | undefined;

export async function saveProduct(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const fields = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)]));
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { errors: {}, message: MANAGERS_ONLY, fields };

  const productId = String(formData.get("product_id") ?? "");
  if (productId && !isUuid(productId)) return { errors: {}, message: "That product doesn't exist.", fields };
  const parsed = parseProductForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, message: "Fix the highlighted fields.", fields };
  const supplierId = parsed.value.supplier_id;
  if (supplierId && !isUuid(supplierId)) return { errors: {}, message: "Choose a supplier from the list.", fields };

  const row = { ...parsed.value, is_active: productId ? formData.get("is_active") === "on" : true };
  const { data, error } = productId
    ? await supabase.from("products").update(row).eq("id", productId).select("id").maybeSingle()
    : await supabase.from("products").insert({ ...row, business_id: me.business_id }).select("id").single();
  if (error?.code === "23505") {
    const field = error.message.includes("barcode") ? "barcode" : "sku";
    return { errors: { [field]: `Another product has this ${field === "sku" ? "SKU" : "barcode"}.` }, message: "Fix the highlighted fields.", fields };
  }
  if (error?.code === "42501") return { errors: {}, message: MANAGERS_ONLY, fields };
  if (error) throw error;
  if (!data) return { errors: {}, message: "That product doesn't exist.", fields };
  refresh();
  redirect(`/inventory/${data.id}`);
}

export type StockResult = { ok: true; message: string } | { ok: false; message: string };

// A manual correction in the product's unit, with a reason (managers).
export async function adjustProduct(productId: string, change: string, direction: "add" | "remove", note: string): Promise<StockResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { ok: false, message: MANAGERS_ONLY };
  const amount = parseAmount(change);
  if (!isUuid(productId) || amount === null) return { ok: false, message: "Enter an amount, e.g. 30 or 2.5." };
  if (!note.trim()) return { ok: false, message: "Say why, e.g. “Dropped a tube”." };
  const { error } = await supabase.rpc("adjust_stock", {
    p_location_id: me.location.id,
    p_product_id: productId,
    p_change: direction === "add" ? amount : -amount,
    p_reason: "adjustment",
    p_note: note.trim().slice(0, 500),
  });
  if (error?.code === "42501") return { ok: false, message: MANAGERS_ONLY };
  if (error) throw error;
  refresh();
  return { ok: true, message: "Stock adjusted." };
}

export async function saveStockSettings(productId: string, reorderPoint: string, reorderQuantity: string): Promise<StockResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { ok: false, message: MANAGERS_ONLY };
  const point = reorderPoint.trim() === "0" ? 0 : parseAmount(reorderPoint);
  const quantity = Number(reorderQuantity);
  if (!isUuid(productId) || point === null) return { ok: false, message: "Enter the reorder point, e.g. 120." };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return { ok: false, message: "Order at least 1 at a time." };
  const { error } = await supabase.rpc("set_stock_settings", { p_location_id: me.location.id, p_product_id: productId, p_reorder_point: point, p_reorder_quantity: quantity });
  if (error?.code === "42501") return { ok: false, message: MANAGERS_ONLY };
  if (error) throw error;
  refresh();
  return { ok: true, message: "Saved." };
}

export type SupplierFormState = { message?: string; saved?: boolean; fields: Record<string, string> } | undefined;

export async function addSupplier(_prev: SupplierFormState, formData: FormData): Promise<SupplierFormState> {
  const fields = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)]));
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { message: "Only owners and managers can add suppliers.", fields };
  const name = fields.name?.trim() ?? "";
  const email = fields.email?.trim() || null;
  const lead = Number(fields.lead_time_days || 3);
  if (!name) return { message: "Enter the supplier's name.", fields };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { message: "Check the email address.", fields };
  if (!Number.isInteger(lead) || lead < 0 || lead > 60) return { message: "Lead time is 0 to 60 days.", fields };
  const { error } = await supabase.from("suppliers").insert({
    business_id: me.business_id,
    name: name.slice(0, 200),
    email,
    phone: fields.phone?.trim().slice(0, 50) || null,
    account_number: fields.account_number?.trim().slice(0, 100) || null,
    lead_time_days: lead,
  });
  if (error?.code === "23505") return { message: "There's already a supplier with this name.", fields };
  if (error?.code === "42501") return { message: "Only owners and managers can add suppliers.", fields };
  if (error) throw error;
  refresh();
  return { saved: true, fields: {} };
}
