"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";

export async function saveFreeTextRoles(roles: string[]) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: "Sign in again." };
  const { error } = await supabase.rpc("set_free_text_roles", { p_business_id: me.business_id, p_roles: roles });
  if (error) return { ok: false, message: error.code === "42501" ? "Only owners change this." : "That didn't save. Try again." };
  revalidatePath("/settings/messages");
  return { ok: true, message: "Saved." };
}

// Which answer "Let Maria know about the new time?" leans to after staff
// move a visit. Only the first button: neither sends without a tap.
export async function saveMoveMessageDefault(value: string) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "settings")) return { ok: false, message: "Only those who can change settings can change this." };
  if (value !== "send" && value !== "skip") return { ok: false, message: "Choose one." };
  const { data, error } = await supabase.from("businesses").update({ move_message_default: value }).eq("id", me.business_id).select("id");
  if (error || !data.length) return { ok: false, message: "That didn't save. Try again." };
  revalidatePath("/settings/messages");
  return { ok: true, message: "Saved." };
}
