"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";

// Confirming, dismissing and undoing a task Denise prepared
// (lib/denise/tasks.ts). The database decides who may (apply_task_action:
// as set_staff_timings) and that nothing changed since.

export type TaskResult = { ok: boolean; message: string };

const GONE = "That task no longer exists.";

function failed(error: { code?: string; message: string }): TaskResult {
  if (error.code === "42501") return { ok: false, message: "Only owners and managers who manage the team can change service times." };
  if (error.code === "P0002") return { ok: false, message: GONE };
  if (error.code === "55000") return { ok: false, message: `${error.message}.` };
  throw error;
}

function changed() {
  revalidatePath("/team", "layout");
  revalidatePath("/calendar", "layout");
}

export async function confirmTask(actionId: string): Promise<TaskResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(actionId)) return { ok: false, message: GONE };
  const { error } = await supabase.rpc("apply_task_action", { p_action_id: actionId });
  if (error) return failed(error);
  changed();
  return { ok: true, message: "Done. New bookings use the new times." };
}

export async function dismissTask(actionId: string): Promise<TaskResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(actionId)) return { ok: false, message: GONE };
  const { error } = await supabase.rpc("reject_ai_action", { p_action_id: actionId });
  if (error) return failed(error);
  return { ok: true, message: "Dismissed. Nothing changed." };
}

export async function undoTask(actionId: string): Promise<TaskResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(actionId)) return { ok: false, message: GONE };
  const { error } = await supabase.rpc("undo_task_action", { p_action_id: actionId });
  if (error) return failed(error);
  changed();
  return { ok: true, message: "Undone. The times are back as they were." };
}
