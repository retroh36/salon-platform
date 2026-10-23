"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { recomputeForVisit } from "@/lib/insights/compute";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { canRefund, canTakePayments, loadCheckout, loadSale, receiptSalon, receiptText, type CheckoutData } from "@/lib/sales";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PaymentMethod } from "@/lib/checkout";

export type SaleLineInput =
  | { kind: "service"; appointmentItemId: string; unitPriceCents: number; priceReason: string }
  | { kind: "product"; productId: string; quantity: number };

export type SaleInput = {
  appointmentId: string | null;
  clientId: string | null;
  lines: SaleLineInput[];
  discount: { kind: "amount" | "percent"; value: number; reason: string } | null;
  tips: { staffId: string; amountCents: number }[];
  payments: { method: PaymentMethod; amountCents: number; tenderedCents?: number; reference?: string }[];
  receiptEmail: string | null;
};

export type SaleResult = { ok: true; saleId: string } | { ok: false; message: string };

const NOT_ALLOWED = "Only the front desk, managers and owners can take payments.";

// Our database functions raise messages written for staff; anything else
// gets a general one.
function messageFor(error: { code?: string; message: string }, fallback: string): string {
  return ["22023", "42501", "55000", "P0002"].includes(error.code ?? "") ? error.message : fallback;
}

function refresh() {
  revalidatePath("/calendar", "layout");
  revalidatePath("/sales", "layout");
}

export async function completeSale(input: SaleInput): Promise<SaleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canTakePayments(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (input.appointmentId && !isUuid(input.appointmentId)) return { ok: false, message: "That visit no longer exists." };
  if (input.clientId && !isUuid(input.clientId)) return { ok: false, message: "That client no longer exists." };
  if (input.receiptEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.receiptEmail)) return { ok: false, message: "Enter a valid email for the receipt." };

  const { data, error } = await supabase.rpc("complete_sale", {
    p_location_id: me.location.id,
    p_input: {
      appointment_id: input.appointmentId,
      client_id: input.clientId,
      lines: input.lines.map((l) =>
        l.kind === "service"
          ? { kind: "service", appointment_item_id: l.appointmentItemId, unit_price_cents: l.unitPriceCents, price_reason: l.priceReason }
          : { kind: "product", product_id: l.productId, quantity: l.quantity },
      ),
      discount: input.discount,
      tips: input.tips.map((t) => ({ staff_id: t.staffId, amount_cents: t.amountCents })),
      payments: input.payments.map((p) => ({ method: p.method, amount_cents: p.amountCents, tendered_cents: p.tenderedCents ?? null, reference: p.reference ?? null })),
      receipt_email: input.receiptEmail,
    },
  });
  if (error) return { ok: false, message: messageFor(error, "That didn't go through. Try again.") };
  refresh();
  // What Denise learns from the visit, as after any checkout.
  if (input.appointmentId) after(() => recomputeForVisit(createAdminClient(), input.appointmentId!));
  if (input.receiptEmail) await emailReceipt(data, input.receiptEmail);
  return { ok: true, saleId: data };
}

export type SimpleResult = { ok: true; message: string } | { ok: false; message: string };

export async function voidSale(saleId: string, reason: string): Promise<SimpleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canRefund(me.role)) return { ok: false, message: "Only managers and owners can void a sale." };
  if (!isUuid(saleId)) return { ok: false, message: "That sale doesn't exist." };
  const { error } = await supabase.rpc("void_sale", { p_sale_id: saleId, p_reason: reason });
  if (error) return { ok: false, message: messageFor(error, "That didn't go through. Try again.") };
  refresh();
  return { ok: true, message: "Voided. Payments are reversed and products are back in stock." };
}

export async function refundSale(
  saleId: string,
  input: { reason: string; payments: { method: "cash" | "card"; amountCents: number; reference?: string }[]; returns: { saleItemId: string; quantity: number }[]; restock: boolean },
): Promise<SimpleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canRefund(me.role)) return { ok: false, message: "Only managers and owners can refund." };
  if (!isUuid(saleId) || input.returns.some((r) => !isUuid(r.saleItemId))) return { ok: false, message: "That sale doesn't exist." };
  const { error } = await supabase.rpc("refund_sale", {
    p_sale_id: saleId,
    p_input: {
      reason: input.reason,
      payments: input.payments.map((p) => ({ method: p.method, amount_cents: p.amountCents, reference: p.reference ?? null })),
      returns: input.returns.map((r) => ({ sale_item_id: r.saleItemId, quantity: r.quantity })),
      restock: input.restock,
    },
  });
  if (error) return { ok: false, message: messageFor(error, "That didn't go through. Try again.") };
  refresh();
  return { ok: true, message: "Refunded." };
}

// The receipt by email, through the outbox (shown at /dev/outbox until
// email is connected).
export async function emailReceipt(saleId: string, email: string): Promise<SimpleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canTakePayments(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(saleId)) return { ok: false, message: "That sale doesn't exist." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { ok: false, message: "Enter a valid email." };
  const sale = await loadSale(supabase, saleId);
  if (!sale) return { ok: false, message: "That sale doesn't exist." };
  const salon = await receiptSalon(me.business_id, me.location.id);
  const at = toLocal(new Date(sale.createdAt), me.location.timezone);
  const receipt = receiptText(sale, salon, `${formatDay(at.date)}, ${formatMinute(at.minute)}`);
  const { error } = await supabase.rpc("log_receipt_email", { p_sale_id: saleId, p_email: email.trim() });
  if (error) return { ok: false, message: messageFor(error, "That didn't go through. Try again.") };
  const { error: outboxError } = await createAdminClient()
    .from("outbox_messages")
    .insert({ business_id: me.business_id, channel: "email", to_address: email.trim(), subject: receipt.subject, body: receipt.text, html: receipt.html });
  if (outboxError) throw outboxError;
  return { ok: true, message: `Receipt sent to ${email.trim()}.` };
}

// What the checkout panel needs for a visit.
export async function checkoutFor(appointmentId: string): Promise<CheckoutData | null> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canTakePayments(me.role) || !isUuid(appointmentId)) return null;
  return loadCheckout(supabase, me, appointmentId);
}
