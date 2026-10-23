"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { parseDollars } from "@/lib/checkout";
import { isUuid } from "@/lib/ids";
import { STAFF_LEVELS, type StaffLevel } from "@/lib/schedule-forms";

export type PackageInput = {
  id: string | null;
  name: string;
  price: string;
  expiryMonths: string;
  levels: StaffLevel[];
  isActive: boolean;
  items: { serviceId: string; quantity: string }[];
};

export type SaveResult = { ok: true; message: string; id: string } | { ok: false; message: string };

export async function savePackage(input: PackageInput): Promise<SaveResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || me.role !== "owner") return { ok: false, message: "Only owners can set up packages." };
  const name = input.name.trim();
  if (!name || name.length > 120) return { ok: false, message: "Give the package a name." };
  const price = parseDollars(input.price);
  if (!price || price < 100) return { ok: false, message: "Enter the package's price." };
  const months = input.expiryMonths.trim() ? Number(input.expiryMonths) : null;
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 60)) return { ok: false, message: "Enter how many months it lasts (1 to 60), or leave it empty." };
  const items = input.items.filter((i) => i.serviceId).map((i) => ({ service_id: i.serviceId, quantity: Number(i.quantity) }));
  if (!items.length || items.some((i) => !isUuid(i.service_id) || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 100)) {
    return { ok: false, message: "Add services and how many of each (1 to 100)." };
  }
  const levels = input.levels.filter((l) => (STAFF_LEVELS as readonly string[]).includes(l));
  const { data, error } = await supabase.rpc("save_package_template", {
    p_template_id: input.id && isUuid(input.id) ? input.id : null!,
    p_input: { name, price_cents: price, expiry_months: months, levels: levels.length && levels.length < STAFF_LEVELS.length ? levels : null, is_active: input.isActive, items },
  });
  if (error) return { ok: false, message: ["22023", "42501", "P0002"].includes(error.code ?? "") ? error.message : "That didn't save. Try again." };
  revalidatePath("/settings/packages");
  return { ok: true, message: "Saved.", id: data };
}
