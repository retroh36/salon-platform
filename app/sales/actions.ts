"use server";

import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { recomputeForVisit } from "@/lib/insights/compute";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { canTakePayments, loadSale, receiptSalon, receiptText } from "@/lib/sales";
import { formatDay, formatLongDay } from "@/lib/schedule-format";
import { giftCardEmail, isCardCode, type GiftCardLookup } from "@/lib/gift-cards";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PaymentMethod } from "@/lib/checkout";
import { providerFor } from "@/lib/payments";
import { formatPrice } from "@/lib/services";

export type SaleLineInput =
  // packageItemId: a use of the client's package pays for it.
  | { kind: "service"; appointmentItemId: string; unitPriceCents: number; priceReason: string; packageItemId?: string | null }
  | { kind: "package"; templateId: string }
  | { kind: "product"; productId: string; quantity: number }
  // A physical card has its own code; a digital one gets one and is emailed.
  | { kind: "gift_card"; amountCents: number; code: string | null; recipientName: string | null; recipientEmail: string | null }
  | { kind: "gift_card_reload"; code: string; amountCents: number };

export type SaleInput = {
  appointmentId: string | null;
  clientId: string | null;
  lines: SaleLineInput[];
  discount: { kind: "amount" | "percent"; value: number; reason: string } | null;
  tips: { staffId: string; amountCents: number }[];
  payments: { method: PaymentMethod; amountCents: number; tenderedCents?: number; reference?: string; code?: string }[];
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
      lines: input.lines.map((l) => {
        switch (l.kind) {
          case "service":
            return { kind: "service", appointment_item_id: l.appointmentItemId, unit_price_cents: l.unitPriceCents, price_reason: l.priceReason, package_item_id: l.packageItemId ?? null };
          case "package":
            return { kind: "package", template_id: l.templateId };
          case "product":
            return { kind: "product", product_id: l.productId, quantity: l.quantity };
          case "gift_card":
            return { kind: "gift_card", amount_cents: l.amountCents, code: l.code, recipient_name: l.recipientName, recipient_email: l.recipientEmail };
          case "gift_card_reload":
            return { kind: "gift_card_reload", code: l.code, amount_cents: l.amountCents };
        }
      }),
      discount: input.discount,
      tips: input.tips.map((t) => ({ staff_id: t.staffId, amount_cents: t.amountCents })),
      payments: input.payments.map((p) => ({ method: p.method, amount_cents: p.amountCents, tendered_cents: p.tenderedCents ?? null, reference: p.reference ?? null, code: p.code ?? null })),
      receipt_email: input.receiptEmail,
    },
  });
  if (error) return { ok: false, message: messageFor(error, "That didn't go through. Try again.") };
  refresh();
  // What Denise learns from the visit, as after any checkout.
  if (input.appointmentId) after(() => recomputeForVisit(createAdminClient(), input.appointmentId!));
  if (input.receiptEmail) await emailReceipt(data, input.receiptEmail);
  // Digital gift cards go out by email.
  const { data: cards } = await supabase.from("gift_cards").select("id, recipient_email").eq("sale_id", data).not("recipient_email", "is", null);
  for (const card of cards ?? []) await sendGiftCard(card.id, card.recipient_email!);
  return { ok: true, saleId: data };
}

export type SimpleResult = { ok: true; message: string } | { ok: false; message: string };

export async function voidSale(saleId: string, reason: string): Promise<SimpleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "void_refund")) return { ok: false, message: "Only managers and owners can void a sale." };
  if (!isUuid(saleId)) return { ok: false, message: "That sale doesn't exist." };
  const { error } = await supabase.rpc("void_sale", { p_sale_id: saleId, p_reason: reason });
  if (error) return { ok: false, message: messageFor(error, "That didn't go through. Try again.") };
  const cards = await refundOnlineCards(supabase, saleId);
  refresh();
  return {
    ok: true,
    message: `Voided. Payments are reversed and products are back in stock.${cards.refundedCents ? ` ${formatPrice(cards.refundedCents)} went back to the card online.` : ""}${cards.failedCents ? ` The card refund of ${formatPrice(cards.failedCents)} didn't go through: tap Try the card refund again.` : ""}`,
  };
}

// The card refunds a void made due (cards taken online: a payment link, a
// deposit, a renewal), through the payment provider each was charged with.
async function refundOnlineCards(supabase: Awaited<ReturnType<typeof getCurrentStaff>>["supabase"], saleId: string) {
  const { data: due, error } = await supabase.from("payments").select("id, amount_cents, processor, processor_reference").eq("sale_id", saleId).in("provider_refund", ["due", "failed"]);
  if (error) throw error;
  let refundedCents = 0;
  let failedCents = 0;
  for (const p of due) {
    const result = p.processor && p.processor_reference ? await providerFor(p.processor).refund(p.processor_reference) : { ok: false };
    const { error: recordError } = await supabase.rpc("record_provider_refund", { p_payment_id: p.id, p_ok: result.ok });
    if (recordError) throw recordError;
    if (result.ok) refundedCents -= p.amount_cents;
    else failedCents -= p.amount_cents;
  }
  return { refundedCents, failedCents };
}

export async function retryCardRefunds(saleId: string): Promise<SimpleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "void_refund")) return { ok: false, message: "Only managers and owners can refund." };
  if (!isUuid(saleId)) return { ok: false, message: "That sale doesn't exist." };
  const cards = await refundOnlineCards(supabase, saleId);
  refresh();
  if (cards.failedCents) return { ok: false, message: `The card refund of ${formatPrice(cards.failedCents)} didn't go through. Try again in a few minutes.` };
  return { ok: true, message: `${formatPrice(cards.refundedCents)} went back to the card online.` };
}

export async function refundSale(
  saleId: string,
  input: { reason: string; payments: { method: "cash" | "card" | "gift_card"; amountCents: number; reference?: string; code?: string }[]; returns: { saleItemId: string; quantity: number }[]; restock: boolean },
): Promise<SimpleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "void_refund")) return { ok: false, message: "Only managers and owners can refund." };
  if (!isUuid(saleId) || input.returns.some((r) => !isUuid(r.saleItemId))) return { ok: false, message: "That sale doesn't exist." };
  const { error } = await supabase.rpc("refund_sale", {
    p_sale_id: saleId,
    p_input: {
      reason: input.reason,
      payments: input.payments.map((p) => ({ method: p.method, amount_cents: p.amountCents, reference: p.reference ?? null, code: p.code ?? null })),
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

export type LookupResult = { ok: true; card: GiftCardLookup } | { ok: false; message: string };

// A gift card's balance by its code (logged, and limited per person).
export async function lookupGiftCard(code: string): Promise<LookupResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canTakePayments(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isCardCode(code)) return { ok: false, message: "Enter the card's code (8 or more letters and numbers)." };
  const { data, error } = await supabase.rpc("lookup_gift_card", { p_code: code });
  if (error?.code === "54000") return { ok: false, message: error.message };
  if (error) return { ok: false, message: messageFor(error, "That didn't work. Try again.") };
  if (!data) return { ok: false, message: "No gift card has that code." };
  return { ok: true, card: data as unknown as GiftCardLookup };
}

// A digital gift card by email, through the outbox.
export async function sendGiftCard(cardId: string, email: string): Promise<SimpleResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canTakePayments(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(cardId)) return { ok: false, message: "That gift card doesn't exist." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { ok: false, message: "Enter a valid email." };
  const { data: card } = await supabase.from("gift_cards").select("code, initial_cents, recipient_name, expires_at, status").eq("id", cardId).maybeSingle();
  if (!card || card.status === "voided") return { ok: false, message: "That gift card can't be sent." };
  const [salon, { data: site }] = await Promise.all([
    receiptSalon(me.business_id, me.location.id),
    createAdminClient().from("businesses").select("slug").eq("id", me.business_id).single(),
  ]);
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  const email_ = giftCardEmail({
    code: card.code,
    amountCents: card.initial_cents,
    recipientName: card.recipient_name,
    expiresOn: card.expires_at ? formatLongDay(toLocal(new Date(card.expires_at), me.location.timezone).date) : null,
    salon: { name: salon.name, locationName: salon.locationName, accentColor: salon.accentColor, bookingUrl: base && site?.slug ? `${base}/book/${site.slug}` : null },
  });
  const { error } = await createAdminClient()
    .from("outbox_messages")
    .insert({ business_id: me.business_id, channel: "email", to_address: email.trim(), subject: email_.subject, body: email_.text, html: email_.html });
  if (error) throw error;
  return { ok: true, message: `Gift card sent to ${email.trim()}.` };
}
