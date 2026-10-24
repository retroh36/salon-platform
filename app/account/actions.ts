"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";

export type PinResult = { ok: true; message: string } | { ok: false; message: string };

// Your own PIN for switching in on the shared iPad (hashed by the
// database; it also refuses easy ones like 1234).
export async function savePin(pin: string, again: string): Promise<PinResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: "Sign in again." };
  if (pin !== again) return { ok: false, message: "The two PINs don't match." };
  const { error } = await supabase.rpc("set_my_pin", { p_business_id: me.business_id, p_pin: pin });
  if (error?.code === "22023") return { ok: false, message: error.message };
  if (error) throw error;
  revalidatePath("/account");
  return { ok: true, message: "Saved. Tap your name on a shared iPad and enter it to switch in." };
}
