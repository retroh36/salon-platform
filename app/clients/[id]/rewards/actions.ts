"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { points } from "@/lib/rewards";

export async function adjustPoints(clientId: string, delta: string, reason: string): Promise<{ ok: boolean; message: string }> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "adjust_points")) return { ok: false, message: "You can't adjust points. An owner can allow it on your page in Team." };
  const n = Number(delta.trim().replace(/^\+/, ""));
  if (!isUuid(clientId) || !Number.isInteger(n) || n === 0 || Math.abs(n) > 100_000) return { ok: false, message: "Enter the points to add (like 50) or take off (like -50)." };
  if (!reason.trim()) return { ok: false, message: "Say why." };
  const { data, error } = await supabase.rpc("adjust_reward_points", { p_client_id: clientId, p_delta: n, p_reason: reason.trim() });
  if (error) return { ok: false, message: ["22023", "42501"].includes(error.code ?? "") ? error.message : "That didn't save. Try again." };
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: `Saved. ${points(data)} now.` };
}
