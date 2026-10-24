"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { parseDollars } from "@/lib/checkout";
import { can } from "@/lib/permissions";

export type SettingsResult = { ok: true; message: string } | { ok: false; message: string };

export async function saveGiftCardSettings(input: { presets: string; expiryMonths: string; promoDays: string }): Promise<SettingsResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers can change gift card settings." };
  const presets = input.presets
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map(parseDollars);
  if (presets.some((p) => p === null || p < 500 || p > 100000) || presets.length > 8) return { ok: false, message: "Presets are amounts from $5 to $1,000, up to eight, separated by commas." };
  const months = input.expiryMonths.trim() ? Number(input.expiryMonths) : null;
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) return { ok: false, message: "Enter how many months cards last (1 to 120), or leave it empty for no expiry." };
  const days = Number(input.promoDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { ok: false, message: "Enter how many days promotional cards last (1 to 3650)." };
  const { error } = await supabase.rpc("set_gift_card_settings", { p_business_id: me.business_id, p_presets: presets as number[], p_expiry_months: months!, p_promo_days: days });
  if (error?.code === "42501") return { ok: false, message: "Only owners and managers can change gift card settings." };
  if (error) throw error;
  revalidatePath("/settings/gift-cards");
  return { ok: true, message: "Saved." };
}
