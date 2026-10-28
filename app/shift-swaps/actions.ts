"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { isLocalDate } from "@/lib/scheduling/time";

export type SwapState = { ok?: boolean; message?: string } | undefined;

function refresh() {
  revalidatePath("/shift-swaps");
  revalidatePath("/scheduling", "layout");
  revalidatePath("/schedule", "layout");
  revalidatePath("/my-day");
}

// The database's own words for a rule it refuses on; anything else is ours.
function problem(error: { code?: string; message: string } | null): string | null {
  if (!error) return null;
  if (error.code === "42501" || error.code === "22023") return error.message;
  throw error;
}

export async function askForSwap(_prev: SwapState, form: FormData): Promise<SwapState> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { message: "Sign in again." };
  const to = String(form.get("to_staff_id") ?? "");
  const give = String(form.get("give_date") ?? "");
  const take = String(form.get("take_date") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!isUuid(to)) return { message: "Choose a coworker." };
  if (!isLocalDate(give)) return { message: "Choose the day you're giving away." };
  if (take && !isLocalDate(take)) return { message: "Choose their day, or none." };
  if (note.length > 300) return { message: "Keep the note under 300 characters." };
  const { error } = await supabase.rpc("request_shift_swap", { p_to_staff_id: to, p_give_date: give, p_take_date: take || undefined, p_note: note || undefined });
  const message = problem(error);
  if (message) return { message };
  refresh();
  return { ok: true, message: "Asked. They'll see it on Shift swaps." };
}

export async function answerSwap(id: string, accept: boolean): Promise<SwapState> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(id)) return { message: "That swap can't be answered." };
  const message = problem((await supabase.rpc("answer_shift_swap", { p_swap_id: id, p_accept: accept })).error);
  if (message) return { message };
  refresh();
  return { ok: true, message: accept ? "Accepted. A manager will approve it." : "Said no." };
}

export async function cancelSwap(id: string): Promise<SwapState> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(id)) return { message: "That swap can't be canceled." };
  const message = problem((await supabase.rpc("cancel_shift_swap", { p_swap_id: id })).error);
  if (message) return { message };
  refresh();
  return { ok: true, message: "Canceled." };
}

export async function decideSwap(id: string, approve: boolean, reason?: string): Promise<SwapState> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role) || !isUuid(id)) return { message: "Only owners and managers approve shift swaps." };
  if (!approve && !reason?.trim()) return { message: "Say why it's declined. They'll both see it." };
  const message = problem((await supabase.rpc("decide_shift_swap", { p_swap_id: id, p_approve: approve, p_reason: reason?.trim() || undefined })).error);
  if (message) return { message };
  refresh();
  return { ok: true, message: approve ? "Approved. Their schedules are updated." : "Declined." };
}
