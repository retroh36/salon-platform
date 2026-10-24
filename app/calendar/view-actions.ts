"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { viewProblems, VIEW_NAME_MAX } from "@/lib/calendar-views";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";

// Saved calendar views and the salon's column order. The database checks
// who may do what (save_calendar_view, delete_calendar_view,
// set_calendar_order); these say it in words.

export type ViewResult = { ok: true; id: string } | { ok: false; message: string; field?: "name" | "staff" };

const MAX_STAFF = 200;

function refresh() {
  revalidatePath("/calendar", "layout");
  revalidatePath("/team", "layout");
}

const ids = (list: unknown): string[] | null => (Array.isArray(list) && list.length <= MAX_STAFF && list.every((id) => typeof id === "string" && isUuid(id)) ? (list as string[]) : null);

export async function saveCalendarView(input: { id: string | null; name: string; staffIds: string[]; shared: boolean }): Promise<ViewResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: "Sign in again to save a view." };
  const staffIds = ids(input.staffIds);
  if (!staffIds || (input.id !== null && !isUuid(input.id)) || typeof input.name !== "string") return { ok: false, message: "That view can't be saved." };
  const problems = viewProblems(input.name.slice(0, VIEW_NAME_MAX + 1), staffIds, []);
  if (problems.name) return { ok: false, message: problems.name, field: "name" };
  if (problems.staff) return { ok: false, message: problems.staff, field: "staff" };
  if (input.shared && !can(me, "settings")) return { ok: false, message: "Only owners and managers make views for everyone." };

  const { data, error } = await supabase.rpc("save_calendar_view", {
    p_location_id: me.location.id,
    p_view_id: input.id!,
    p_name: input.name.trim(),
    p_staff_ids: staffIds,
    p_shared: input.shared,
  });
  if (error?.code === "23505") return { ok: false, message: `There's already a view called ${input.name.trim()}.`, field: "name" };
  if (error?.code === "42501") return { ok: false, message: input.shared ? "Only owners change views for everyone." : "That view isn't yours to change." };
  if (error?.code === "22023") return { ok: false, message: "Choose at least one stylist.", field: "staff" };
  if (error) throw error;
  refresh();
  return { ok: true, id: data };
}

export async function deleteCalendarView(id: string): Promise<{ ok: boolean; message?: string }> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(id)) return { ok: false, message: "That view no longer exists." };
  const { error } = await supabase.rpc("delete_calendar_view", { p_view_id: id });
  if (error?.code === "42501") return { ok: false, message: "That view isn't yours to delete." };
  if (error) throw error;
  refresh();
  return { ok: true };
}

// The salon's default column order (owners), first to last.
export async function setCalendarOrder(staffIds: string[]): Promise<{ ok: boolean; message?: string }> {
  const { supabase, staff: me } = await getCurrentStaff();
  const list = ids(staffIds);
  if (!can(me, "settings") || !list) return { ok: false, message: "Only owners and managers set the calendar order." };
  const { error } = await supabase.rpc("set_calendar_order", { p_business_id: me.business_id, p_staff_ids: list });
  if (error?.code === "42501") return { ok: false, message: "Only owners set the calendar order." };
  if (error) throw error;
  refresh();
  return { ok: true };
}
