"use server";

import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";

// Marks the signed-in person's own notices as read.
export async function markNoticesRead(ids: string[]) {
  const { supabase } = await getCurrentStaff();
  const valid = (Array.isArray(ids) ? ids : []).filter(isUuid).slice(0, 100);
  if (!valid.length) return;
  const { error } = await supabase.rpc("mark_notices_read", { p_ids: valid });
  if (error) throw error;
}
