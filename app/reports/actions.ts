"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { parseDollars } from "@/lib/checkout";
import { isLocalDate } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";

export type CloseoutResult = { ok: true; message: string } | { ok: false; message: string };

// The day's counted cash against the float and what the sales say (owners).
export async function saveCloseout(day: string, counted: string, note: string, float: string): Promise<CloseoutResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || me.role !== "owner") return { ok: false, message: "Only owners can close out the day." };
  const cents = parseDollars(counted);
  if (!isLocalDate(day) || cents === null) return { ok: false, message: "Enter the cash counted." };
  const floatCents = parseDollars(float || "0");
  if (floatCents === null || floatCents > 1_000_000) return { ok: false, message: "Enter the starting float." };
  const { data, error } = await supabase.rpc("save_closeout", { p_location_id: me.location.id, p_day: day, p_counted_cents: cents, p_note: note, p_float_cents: floatCents });
  if (error) return { ok: false, message: error.code === "42501" ? "Only owners can close out the day." : "That didn't save. Try again." };
  revalidatePath("/reports");
  return { ok: true, message: data === 0 ? "Saved. The drawer matches." : `Saved. The drawer is ${formatPrice(Math.abs(data))} ${data > 0 ? "over" : "short"}.` };
}
