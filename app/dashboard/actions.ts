"use server";

import { getCurrentStaff } from "@/lib/auth";
import { loadLive, type LiveData } from "@/lib/dashboard-load";

// What's happening right now, for the Dashboard to refresh every 30 seconds.
export async function refreshLive(): Promise<LiveData | null> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return null;
  return loadLive(supabase, me);
}
