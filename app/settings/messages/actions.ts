"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";

export async function saveFreeTextRoles(roles: string[]) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: "Sign in again." };
  const { error } = await supabase.rpc("set_free_text_roles", { p_business_id: me.business_id, p_roles: roles });
  if (error) return { ok: false, message: error.code === "42501" ? "Only owners change this." : "That didn't save. Try again." };
  revalidatePath("/settings/messages");
  return { ok: true, message: "Saved." };
}
