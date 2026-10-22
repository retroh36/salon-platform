"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { suggestReorders, type ReorderSuggestion } from "@/lib/denise/reorder";
import { isUuid } from "@/lib/ids";
import { canManageInventory, canReceiveOrders } from "@/lib/inventory";
import { orderNumber, parseOrderLines, parseReceipt } from "@/lib/purchase-orders";

const MANAGERS_ONLY = "Only owners and managers can write and send orders.";
type Result = { ok: true; message: string; orderId?: string } | { ok: false; message: string };

function refresh() {
  revalidatePath("/inventory", "layout");
}

function errorMessage(code: string | undefined): string | null {
  if (code === "42501") return MANAGERS_ONLY;
  if (code === "55000") return "This order has moved on (sent or received), so it can't be changed that way.";
  if (code === "22023") return "Check the order: every line needs a product, a quantity and a cost.";
  return null;
}

export async function saveOrder(input: { orderId: string | null; supplierId: string; notes: string; lines: string }): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { ok: false, message: MANAGERS_ONLY };
  if ((input.orderId && !isUuid(input.orderId)) || !isUuid(input.supplierId)) return { ok: false, message: "Choose a supplier." };
  const { data: products, error: productError } = await supabase.from("products").select("id");
  if (productError) throw productError;
  const parsed = parseOrderLines(input.lines, new Set(products.map((p) => p.id)));
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const { data, error } = await supabase.rpc("save_purchase_order", {
    p_order_id: input.orderId!,
    p_location_id: me.location.id,
    p_supplier_id: input.supplierId,
    p_notes: input.notes.slice(0, 2000),
    p_lines: parsed.lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, unit_cost_cents: l.unitCostCents })),
  });
  const known = errorMessage(error?.code);
  if (known) return { ok: false, message: known };
  if (error) throw error;
  refresh();
  return { ok: true, message: "Order saved.", orderId: data };
}

export async function sendOrder(orderId: string): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { ok: false, message: MANAGERS_ONLY };
  if (!isUuid(orderId)) return { ok: false, message: "That order doesn't exist." };
  const { error } = await supabase.rpc("send_purchase_order", { p_order_id: orderId });
  if (error?.code === "22023") return { ok: false, message: "Add something to the order first." };
  const known = errorMessage(error?.code);
  if (known) return { ok: false, message: known };
  if (error) throw error;
  refresh();
  return { ok: true, message: "Marked as sent. Receive it here when it arrives." };
}

export async function deleteOrder(orderId: string): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { ok: false, message: MANAGERS_ONLY };
  if (!isUuid(orderId)) return { ok: false, message: "That order doesn't exist." };
  const { error } = await supabase.rpc("delete_purchase_order", { p_order_id: orderId });
  const known = errorMessage(error?.code);
  if (known) return { ok: false, message: known };
  if (error) throw error;
  refresh();
  return { ok: true, message: "Draft deleted." };
}

// A delivery: containers received per line.
export async function receiveOrder(orderId: string, received: Record<string, string>): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canReceiveOrders(me.role)) return { ok: false, message: "Only the front desk, managers and owners can receive orders." };
  if (!isUuid(orderId)) return { ok: false, message: "That order doesn't exist." };
  const { data: lines, error: lineError } = await supabase.from("purchase_order_lines").select("id, quantity, received_quantity").eq("purchase_order_id", orderId);
  if (lineError) throw lineError;
  const parsed = parseReceipt(received, new Map(lines.map((l) => [l.id, l.quantity - l.received_quantity])));
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const { data, error } = await supabase.rpc("receive_purchase_order", {
    p_order_id: orderId,
    p_lines: parsed.lines.map((l) => ({ line_id: l.lineId, quantity: l.quantity })),
  });
  if (error?.code === "42501") return { ok: false, message: "Only the front desk, managers and owners can receive orders." };
  if (error?.code === "55000") return { ok: false, message: "Only sent orders can be received." };
  if (error?.code === "22023") return { ok: false, message: "That's more than was ordered." };
  if (error) throw error;
  refresh();
  return { ok: true, message: data === "received" ? "Received in full. Stock is updated." : "Received. Stock is updated; the rest is still due." };
}

// Denise looks at stock and the next two weeks of bookings.
export async function scanReorders(): Promise<ReorderSuggestion[]> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return [];
  return suggestReorders(supabase, { location: me.location, canManage: canManageInventory(me.role) });
}

export type ReorderResult = { ok: true; message: string; orderId: string } | { ok: false; message: string };

export async function approveReorder(actionId: string): Promise<ReorderResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { ok: false, message: "Only owners and managers can approve orders." };
  if (!isUuid(actionId)) return { ok: false, message: "I can't find that suggestion any more." };
  const { data, error } = await supabase.rpc("apply_reorder_draft", { p_action_id: actionId });
  if (error?.code === "42501") return { ok: false, message: "Only owners and managers can approve orders." };
  if (error?.code === "55000") return { ok: false, message: "Someone has already dealt with this one." };
  if (error) throw error;
  const { data: order } = await supabase.from("purchase_orders").select("number").eq("id", data).single();
  refresh();
  return { ok: true, orderId: data, message: `Done — I've drafted ${order ? orderNumber(order.number) : "the order"}. Review it and send it when you're ready; nothing has been ordered yet.` };
}

export async function undoReorder(actionId: string): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { ok: false, message: MANAGERS_ONLY };
  if (!isUuid(actionId)) return { ok: false, message: "I can't find that suggestion any more." };
  const { error } = await supabase.rpc("undo_reorder_draft", { p_action_id: actionId });
  if (error?.code === "55000") return { ok: false, message: "The order has been sent (or undone already), so I can't take it back." };
  const known = errorMessage(error?.code);
  if (known) return { ok: false, message: known };
  if (error) throw error;
  refresh();
  return { ok: true, message: "Undone — that draft order is gone." };
}

export async function dismissReorder(actionId: string): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManageInventory(me.role)) return { ok: false, message: MANAGERS_ONLY };
  if (!isUuid(actionId)) return { ok: false, message: "I can't find that suggestion any more." };
  const { error } = await supabase.rpc("reject_ai_action", { p_action_id: actionId });
  if (error?.code === "55000") return { ok: false, message: "Someone has already dealt with this one." };
  if (error) throw error;
  return { ok: true, message: "Okay, I'll leave that one for today." };
}
