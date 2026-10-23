"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import type { StaffRole } from "@/lib/staff";

export type CheckoutSettingsInput = {
  taxServicesPercent: string;
  taxRetailPercent: string;
  discountRoles: StaffRole[];
  discountMaxPercent: string;
  receiptFooter: string;
  receiptShowStylists: boolean;
};

export type SettingsResult = { ok: true; message: string } | { ok: false; message: string };

// "8.25" -> 825 basis points; null if it isn't a rate from 0 to 25%.
function basisPoints(text: string): number | null {
  const t = text.trim().replace(/%$/, "");
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(t)) return null;
  const bp = Math.round(Number(t) * 100);
  return bp <= 2500 ? bp : null;
}

export async function saveCheckoutSettings(input: CheckoutSettingsInput): Promise<SettingsResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || me.role !== "owner") return { ok: false, message: "Only owners can change these settings." };
  const services = basisPoints(input.taxServicesPercent || "0");
  const retail = basisPoints(input.taxRetailPercent || "0");
  if (services === null || retail === null) return { ok: false, message: "Enter tax rates from 0 to 25%." };
  const max = Number(input.discountMaxPercent);
  if (!Number.isInteger(max) || max < 0 || max > 100) return { ok: false, message: "Enter a discount limit from 0 to 100%." };
  if (input.receiptFooter.length > 500) return { ok: false, message: "Keep the receipt note under 500 characters." };
  const roles = [...new Set<StaffRole>(["owner", ...input.discountRoles.filter((r) => r === "manager" || r === "front_desk")])];
  const { error } = await supabase.rpc("set_checkout_settings", {
    p_business_id: me.business_id,
    p_settings: { tax_rate_services_bp: services, tax_rate_retail_bp: retail, discount_roles: roles, discount_max_percent: max, receipt_footer: input.receiptFooter, receipt_show_stylists: input.receiptShowStylists },
  });
  if (error?.code === "42501") return { ok: false, message: "Only owners can change these settings." };
  if (error) throw error;
  revalidatePath("/settings/checkout");
  return { ok: true, message: "Saved." };
}
