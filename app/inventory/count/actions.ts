"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { canManageInventory } from "@/lib/inventory";

const MANAGERS_ONLY = "Only owners and managers run stocktakes.";

export async function startStocktake() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) redirect("/inventory");
  const { error } = await supabase.rpc("start_stocktake", { p_location_id: me.location.id });
  if (error) throw error;
  revalidatePath("/inventory/count");
}

export type CountResult = { ok: true; expected: number } | { ok: false; message: string };

export async function recordCount(stocktakeId: string, productId: string, counted: number): Promise<CountResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { ok: false, message: MANAGERS_ONLY };
  if (!isUuid(stocktakeId) || !isUuid(productId)) return { ok: false, message: "That product isn't in this stocktake." };
  if (!Number.isFinite(counted) || counted < 0) return { ok: false, message: "Enter what's on the shelf." };
  const { data, error } = await supabase.rpc("record_count", { p_stocktake_id: stocktakeId, p_product_id: productId, p_counted: counted });
  if (error?.code === "55000") return { ok: false, message: "This stocktake has been finished." };
  if (error?.code === "42501") return { ok: false, message: MANAGERS_ONLY };
  if (error?.code === "22023") return { ok: false, message: "Enter what's on the shelf." };
  if (error) throw error;
  return { ok: true, expected: data };
}

export async function clearCount(stocktakeId: string, productId: string): Promise<{ ok: boolean }> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role) || !isUuid(stocktakeId) || !isUuid(productId)) return { ok: false };
  const { error } = await supabase.rpc("clear_count", { p_stocktake_id: stocktakeId, p_product_id: productId });
  return { ok: !error };
}

export async function finishStocktake(stocktakeId: string): Promise<{ ok: false; message: string }> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { ok: false, message: MANAGERS_ONLY };
  if (!isUuid(stocktakeId)) return { ok: false, message: "That stocktake doesn't exist." };
  const { error } = await supabase.rpc("finish_stocktake", { p_stocktake_id: stocktakeId });
  if (error?.code === "55000") return { ok: false, message: "This stocktake has already been finished." };
  if (error) throw error;
  revalidatePath("/inventory", "layout");
  redirect(`/inventory/count/${stocktakeId}`);
}

export async function cancelStocktake(stocktakeId: string): Promise<{ ok: false; message: string }> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { ok: false, message: MANAGERS_ONLY };
  if (!isUuid(stocktakeId)) return { ok: false, message: "That stocktake doesn't exist." };
  const { error } = await supabase.rpc("cancel_stocktake", { p_stocktake_id: stocktakeId });
  if (error && error.code !== "55000") throw error;
  revalidatePath("/inventory/count");
  redirect("/inventory/count");
}
