"use server";

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
