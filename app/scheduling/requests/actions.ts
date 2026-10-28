"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { isLocalDate } from "@/lib/scheduling/time";

export type DecideState = { message?: string; ok?: boolean } | undefined;

function refresh() {
  revalidatePath("/scheduling", "layout");
  revalidatePath("/schedule", "layout");
  revalidatePath("/calendar");
}

async function decide(id: string, decision: "approved" | "declined", reason?: string): Promise<string | null> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role) || !isUuid(id)) return "Only owners and managers can decide time off.";
  const { error } = await supabase.rpc("decide_time_off", { p_time_off_id: id, p_decision: decision, p_reason: reason });
  if (error?.code === "42501" || error?.code === "22023") return error.message;
  if (error) throw error;
  refresh();
  return null;
}

export async function approveRequest(id: string): Promise<DecideState> {
  const message = await decide(id, "approved");
  return message ? { message } : { ok: true };
}

export async function declineRequest(id: string, _prev: DecideState, form: FormData): Promise<DecideState> {
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { message: "Say why it's declined. They'll see it." };
  if (reason.length > 300) return { message: "Keep it under 300 characters." };
  const message = await decide(id, "declined", reason);
  return message ? { message } : { ok: true };
}

// Approves it, then opens the Mark out panel on the day to plan the clients
// still booked then.
export async function approveAndPlan(id: string, href: string): Promise<DecideState> {
  const target = new URL(href, "http://x");
  const date = target.searchParams.get("date") ?? "";
  if (target.pathname !== "/calendar" || !isLocalDate(date) || !isUuid(target.searchParams.get("out") ?? "")) return { message: "That day can't be opened." };
  const message = await decide(id, "approved");
  if (message) return { message };
  redirect(`${target.pathname}${target.search}`);
}
