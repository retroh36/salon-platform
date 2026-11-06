"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { parseDollars } from "@/lib/checkout";
import { formatPrice } from "@/lib/services";
import { isFrontOfHouse } from "@/lib/staff";

export type DrawerResult = { ok: true; message: string } | { ok: false; message: string };

// The front of house counts the drawer: the opening count, or one during
// the day. The database works out what it should hold; the answer says how
// it compares only once it's saved (a blind count).
export async function countDrawer(kind: "open" | "mid", counted: string, note: string): Promise<DrawerResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isFrontOfHouse(me.role)) return { ok: false, message: "Only the front desk, managers and owners count the drawer." };
  const cents = parseDollars(counted);
  if (cents === null || cents > 10_000_000) return { ok: false, message: "Enter the cash counted." };
  if (kind !== "open" && kind !== "mid") return { ok: false, message: "Choose a count." };
  const { data, error } = await supabase.rpc("count_drawer", { p_location_id: me.location.id, p_kind: kind, p_counted_cents: cents, p_note: note.slice(0, 300) });
  if (error) return { ok: false, message: error.code === "42501" ? "Only the front desk, managers and owners count the drawer." : "That didn't save. Try again." };
  revalidatePath("/sales/drawer");
  revalidatePath("/sales");
  if (data === 0) return { ok: true, message: "Saved. The drawer matches." };
  return { ok: true, message: `Saved. The drawer is ${formatPrice(Math.abs(data))} ${data > 0 ? "over" : "short"}. Owners and managers have been told; count again if you think it's a mistake.` };
}

// Cash today without the opening count: only a manager or owner, with a
// reason (logged and sent as an alert). At the front desk, the manager signs
// in here for a moment (their password isn't kept or logged), as for an
// out-of-stock product.
export async function skipDrawerCount(reason: string, email = "", password = ""): Promise<DrawerResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isFrontOfHouse(me.role)) return { ok: false, message: "Only the front desk, managers and owners take cash." };
  if (reason.trim().length < 3) return { ok: false, message: "Say why the drawer isn't being counted." };
  const args = { p_location_id: me.location.id, p_reason: reason.trim().slice(0, 300) };
  let error: { code?: string; hint?: string } | null;
  if (me.role === "owner" || me.role === "manager") {
    ({ error } = await supabase.rpc("skip_drawer_count", args));
  } else {
    const manager = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signInError } = await manager.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) return { ok: false, message: "That email and password don't match." };
    ({ error } = await manager.rpc("skip_drawer_count", { ...args, p_asked_by: me.id }));
    // Ends only this moment's sign-in, never the manager's other devices.
    await manager.auth.signOut({ scope: "local" });
  }
  if (error) return { ok: false, message: error.code === "42501" ? "Only a manager or owner can skip the count." : error.hint === "reason" ? "Say why the drawer isn't being counted." : "That didn't save. Try again." };
  revalidatePath("/sales/drawer");
  revalidatePath("/sales");
  return { ok: true, message: "Cash can be taken today. Owners and managers have been told." };
}
