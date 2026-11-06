"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { isLocalDate } from "@/lib/scheduling/time";

export type AdjustState = { ok?: boolean; message?: string } | undefined;

// Adds hours to someone's PTO balance or takes them off (a starting
// balance, a correction, hours paid out), always with a reason, logged
// with who did it. Whoever manages the team.
export async function adjustPto(staffId: string, _prev: AdjustState, form: FormData): Promise<AdjustState> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "team")) return { message: "Only those who manage the team can change PTO balances." };
  if (!isUuid(staffId)) return { message: "That team member doesn't exist." };
  const hours = Number(form.get("hours"));
  const sign = form.get("direction") === "take" ? -1 : 1;
  const onDate = String(form.get("on_date") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!Number.isFinite(hours) || hours <= 0 || hours > 4000) return { message: "Enter the hours, up to 4,000." };
  if (!isLocalDate(onDate)) return { message: "Choose the day it counts from." };
  if (reason.length < 3) return { message: "Say why, in a few words." };
  if (reason.length > 300) return { message: "Keep the reason under 300 characters." };
  const { error } = await supabase.rpc("adjust_pto", { p_business_id: me.business_id, p_staff_id: staffId, p_minutes: sign * Math.round(hours * 60), p_on_date: onDate, p_reason: reason });
  if (error?.code === "42501" || error?.code === "22023") return { message: error.message };
  if (error) throw error;
  revalidatePath("/scheduling/balances");
  revalidatePath("/time-off");
  return { ok: true, message: sign > 0 ? `Added ${hours} hr.` : `Took off ${hours} hr.` };
}
