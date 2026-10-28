"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { LOGO_TYPES, MAX_LOGO_BYTES } from "@/lib/branding";
import { isUuid } from "@/lib/ids";
import {
  parseCompensationForm,
  parseTimeOffForm,
  parseWeeklyHoursForm,
  type CompensationErrors,
  type TimeOffErrors,
} from "@/lib/schedule-forms";
import { todayIn, type Weekday } from "@/lib/scheduling/time";

// Each action re-checks the role; RLS enforces the same rules underneath.

export type FormState<Errors> = { errors?: Errors; message?: string; saved?: boolean } | undefined;

const NO_PERMISSION = "Only owners and managers can change schedules.";

function done() {
  revalidatePath("/schedule", "layout");
  return { saved: true };
}

export async function saveWeeklyHours(
  staffId: string,
  _prev: FormState<Partial<Record<Weekday, string>>>,
  formData: FormData,
): Promise<FormState<Partial<Record<Weekday, string>>>> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role) || !isUuid(staffId)) return { message: NO_PERMISSION };

  const parsed = parseWeeklyHoursForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, message: "Fix the highlighted days." };

  const { error } = await supabase.rpc("set_staff_weekly_hours", {
    p_business_id: me.business_id,
    p_staff_id: staffId,
    p_hours: parsed.hours,
  });
  if (error?.code === "42501") return { message: NO_PERMISSION };
  if (error) throw error;
  return done();
}

export async function saveOpeningHours(
  _prev: FormState<Partial<Record<Weekday, string>>>,
  formData: FormData,
): Promise<FormState<Partial<Record<Weekday, string>>>> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { message: "Only owners and managers can change opening hours." };

  const parsed = parseWeeklyHoursForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, message: "Fix the highlighted days." };

  const { error } = await supabase.rpc("set_location_hours", {
    p_business_id: me.business_id,
    p_location_id: me.location.id,
    p_hours: parsed.hours,
  });
  if (error?.code === "42501") return { message: "Only owners and managers can change opening hours." };
  if (error) throw error;
  return done();
}

// Managers add approved time off for anyone (including past days, such as a
// sick day yesterday). Everyone else requests time off for themselves.
export async function addTimeOff(
  staffId: string,
  _prev: FormState<TimeOffErrors>,
  formData: FormData,
): Promise<FormState<TimeOffErrors>> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(staffId)) return { message: "That staff member doesn't exist." };

  const manager = canManage(me.role);
  if (!manager && staffId !== me.id) return { message: "You can only request time off for yourself." };

  const parsed = parseTimeOffForm(formData, { today: todayIn(me.location.timezone), allowPast: manager });
  if (!parsed.ok) return { errors: parsed.errors, message: "Fix the highlighted fields." };

  const { error } = await supabase.from("staff_time_off").insert({
    ...parsed.value,
    business_id: me.business_id,
    staff_id: staffId,
    requested_by: me.id,
    ...(manager
      ? { status: "approved" as const, decided_by: me.id, decided_at: new Date().toISOString() }
      : { status: "requested" as const }),
  });
  if (error?.code === "42501") return { message: "You don't have permission to add this time off." };
  if (error) throw error;
  return done();
}

export async function decideTimeOff(id: string, decision: "approved" | "declined") {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role) || !isUuid(id)) return;

  const { error } = await supabase
    .from("staff_time_off")
    .update({ status: decision, decided_by: me.id, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "requested");
  if (error) throw error;
  done();
}

// Managers can remove any time off; staff can withdraw their own pending
// request (RLS enforces both).
export async function deleteTimeOff(id: string) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(id)) return;

  const { error } = await supabase.from("staff_time_off").delete().eq("id", id);
  if (error) throw error;
  done();
}

export async function saveCompensation(
  staffId: string,
  _prev: FormState<CompensationErrors>,
  formData: FormData,
): Promise<FormState<CompensationErrors>> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role) || !isUuid(staffId)) return { message: "Only owners and managers can change levels and commission." };

  const parsed = parseCompensationForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, message: "Fix the highlighted fields." };

  const { level, ...pay } = parsed.value;
  const [comp, staff] = await Promise.all([
    supabase.from("staff_compensation").upsert({ staff_id: staffId, business_id: me.business_id, ...pay }),
    supabase.from("staff").update({ level }).eq("id", staffId).select("id"),
  ]);
  if (comp.error?.code === "42501" || staff.error?.code === "42501") {
    return { message: "Only owners and managers can change levels and commission." };
  }
  if (comp.error) throw comp.error;
  if (staff.error) throw staff.error;
  return done();
}

export type PhotoResult = { ok: boolean; message: string };
const PHOTO_BUCKET = "staff-photos";

// A stylist's photo for the booking site (owners and managers), stored
// under the business id; the old one is removed.
export async function uploadStaffPhoto(staffId: string, formData: FormData): Promise<PhotoResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role) || !isUuid(staffId)) return { ok: false, message: "Only owners and managers can change photos." };
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an image." };
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { ok: false, message: "Use a PNG, JPEG or WebP image." };
  if (file.size > MAX_LOGO_BYTES) return { ok: false, message: "Use an image up to 2 MB." };

  const { data: before } = await supabase.from("staff").select("photo_path").eq("id", staffId).single();
  const path = `${me.business_id}/staff-${staffId.slice(0, 8)}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, message: "Couldn't upload that image. Try again." };
  const { data, error: updateError } = await supabase.from("staff").update({ photo_path: path }).eq("id", staffId).select("id");
  if (updateError) throw updateError;
  if (!data.length) return { ok: false, message: "Only owners and managers can change photos." };
  if (before?.photo_path) await supabase.storage.from(PHOTO_BUCKET).remove([before.photo_path]);
  revalidatePath("/schedule");
  return { ok: true, message: "Saved the photo." };
}

export async function removeStaffPhoto(staffId: string): Promise<PhotoResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role) || !isUuid(staffId)) return { ok: false, message: "Only owners and managers can change photos." };
  const { data: before } = await supabase.from("staff").select("photo_path").eq("id", staffId).single();
  const { error } = await supabase.from("staff").update({ photo_path: null }).eq("id", staffId);
  if (error) throw error;
  if (before?.photo_path) await supabase.storage.from(PHOTO_BUCKET).remove([before.photo_path]);
  revalidatePath("/schedule");
  return { ok: true, message: "Removed the photo." };
}
