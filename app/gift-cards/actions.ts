"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { parseDollars } from "@/lib/checkout";
import { isCardCode, normalizeCode } from "@/lib/gift-cards";
import { isUuid } from "@/lib/ids";
import { canRefund, canTakePayments } from "@/lib/sales";

export type CardResult = { ok: true; message: string } | { ok: false; message: string };

const message = (error: { code?: string; message: string }) =>
  ["22023", "42501", "55000", "P0002", "54000"].includes(error.code ?? "") ? error.message : "That didn't work. Try again.";

// Look a card up by its code and open it (the lookup is logged).
export async function findCard(code: string): Promise<CardResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canTakePayments(me.role)) return { ok: false, message: "Only the front desk, managers and owners can look up gift cards." };
  if (!isCardCode(code)) return { ok: false, message: "Enter the card's code (8 or more letters and numbers)." };
  const { data, error } = await supabase.rpc("lookup_gift_card", { p_code: normalizeCode(code) });
  if (error) return { ok: false, message: message(error) };
  if (!data) return { ok: false, message: "No gift card has that code." };
  redirect(`/gift-cards/${(data as { id: string }).id}`);
}

export async function issuePromoCard(input: { amount: string; reason: string; days: string; recipientName: string; recipientEmail: string }): Promise<CardResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canRefund(me.role)) return { ok: false, message: "Only managers and owners can issue promotional cards." };
  const cents = parseDollars(input.amount);
  const days = input.days.trim() ? Number(input.days) : null;
  if (!cents) return { ok: false, message: "Enter an amount." };
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) return { ok: false, message: "Enter how many days it lasts (1 to 3650)." };
  const { data, error } = await supabase.rpc("issue_promo_card", {
    p_amount_cents: cents,
    p_reason: input.reason,
    p_expires_in_days: days!,
    p_client_id: null!,
    p_recipient_name: input.recipientName,
    p_recipient_email: input.recipientEmail,
  });
  if (error) return { ok: false, message: message(error) };
  revalidatePath("/gift-cards");
  redirect(`/gift-cards/${data}`);
}

export async function adjustCard(cardId: string, change: string, direction: "add" | "remove", reason: string): Promise<CardResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canRefund(me.role)) return { ok: false, message: "Only managers and owners can adjust gift cards." };
  const cents = parseDollars(change);
  if (!isUuid(cardId) || !cents) return { ok: false, message: "Enter the amount." };
  const { error } = await supabase.rpc("adjust_gift_card", { p_card_id: cardId, p_change_cents: direction === "add" ? cents : -cents, p_reason: reason });
  if (error) return { ok: false, message: message(error) };
  revalidatePath(`/gift-cards/${cardId}`);
  return { ok: true, message: "Adjusted." };
}

export async function voidCard(cardId: string, reason: string): Promise<CardResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canRefund(me.role)) return { ok: false, message: "Only managers and owners can void gift cards." };
  if (!isUuid(cardId)) return { ok: false, message: "That gift card doesn't exist." };
  const { error } = await supabase.rpc("void_gift_card", { p_card_id: cardId, p_reason: reason });
  if (error) return { ok: false, message: message(error) };
  revalidatePath(`/gift-cards/${cardId}`);
  return { ok: true, message: "Voided." };
}
