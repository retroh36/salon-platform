"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { isUuid } from "@/lib/ids";

// Marks the signed-in person's own notices as read.
export async function markNoticesRead(ids: string[]) {
  const { supabase } = await getCurrentStaff();
  const valid = (Array.isArray(ids) ? ids : []).filter(isUuid).slice(0, 100);
  if (!valid.length) return;
  const { error } = await supabase.rpc("mark_notices_read", { p_ids: valid });
  if (error) throw error;
}

export type ClockResult = { ok: true; message: string } | { ok: false; message: string };

// Clocks the signed-in person in or out now.
export async function clockMe(want: "in" | "out"): Promise<ClockResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: "Sign in first." };
  const { data, error } = await supabase.rpc(want === "in" ? "clock_in" : "clock_out", { p_business_id: me.business_id });
  if (error?.hint === "already_in") return { ok: false, message: "You're already clocked in." };
  if (error?.hint === "not_in") return { ok: false, message: "You aren't clocked in." };
  if (error?.hint === "too_long") return { ok: false, message: "You've been clocked in over 18 hours. Ask a manager to fix your hours." };
  if (error?.hint === "clock_off") return { ok: false, message: "This salon doesn't use the time clock." };
  if (error) throw error;
  const at = formatMinute(toLocal(new Date((data as { at: string }).at), me.location.timezone).minute);
  revalidatePath("/my-day");
  return { ok: true, message: want === "in" ? `Clocked in at ${at}.` : `Clocked out at ${at}.` };
}
