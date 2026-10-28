"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { parseStation } from "@/lib/stations";

export type StationState = { ok?: boolean; message?: string; errors?: { name?: string; kind?: string; area?: string } } | undefined;

const NOT_ALLOWED = "Only owners and managers can change stations.";

// Adds or changes a station (id "" for a new one), and whose home chair it is.
export async function saveStation(id: string, _prev: StationState, formData: FormData): Promise<StationState> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "settings")) return { message: NOT_ALLOWED };
  if (id && !isUuid(id)) return { message: "That station isn't here any more." };
  const parsed = parseStation(formData);
  if (!parsed.ok) return { errors: parsed.errors, message: "Fix the highlighted fields." };
  const { station } = parsed;
  if (station.homeStaffId && !isUuid(station.homeStaffId)) return { message: "Choose someone on the team." };

  const row = { name: station.name, kind: station.kind, area: station.area, is_active: station.isActive };
  const saved = id
    ? await supabase.from("resources").update(row).eq("id", id).eq("location_id", me.location.id).select("id").single()
    : await supabase.from("resources").insert({ ...row, business_id: me.business_id, location_id: me.location.id, sort_order: await nextSort(supabase, me.location.id) }).select("id").single();
  if (saved.error?.code === "23505") return { errors: { name: "There's already a station with that name." } };
  if (saved.error?.code === "42501" || saved.error?.code === "PGRST116") return { message: NOT_ALLOWED };
  if (saved.error) throw saved.error;
  const resourceId = saved.data.id;

  // Whose home chair it is: whoever had it lets go first.
  const { data: holders, error } = await supabase.from("staff").select("id").eq("home_resource_id", resourceId);
  if (error) throw error;
  for (const h of holders.filter((h) => h.id !== station.homeStaffId)) {
    const r = await supabase.rpc("set_home_station", { p_staff_id: h.id });
    if (r.error) throw r.error;
  }
  if (station.homeStaffId && !holders.some((h) => h.id === station.homeStaffId)) {
    const r = await supabase.rpc("set_home_station", { p_staff_id: station.homeStaffId, p_resource_id: resourceId });
    if (r.error?.code === "22023") return { message: r.error.message };
    if (r.error?.code === "42501") return { message: NOT_ALLOWED };
    if (r.error) throw r.error;
  }

  revalidatePath("/settings/stations");
  revalidatePath("/scheduling", "layout");
  revalidatePath("/calendar");
  return { ok: true, message: "Saved." };
}

async function nextSort(supabase: Awaited<ReturnType<typeof getCurrentStaff>>["supabase"], locationId: string) {
  const { data } = await supabase.from("resources").select("sort_order").eq("location_id", locationId).order("sort_order", { ascending: false }).limit(1);
  return (data?.[0]?.sort_order ?? 0) + 1;
}
