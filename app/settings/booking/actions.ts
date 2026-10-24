"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { parseBookingSettings, parseServiceOnline, type BookingSettingsErrors } from "@/lib/online-booking/settings";
import { can } from "@/lib/permissions";

export type BookingSettingsState = { ok: true; message: string } | { ok: false; message: string; errors?: BookingSettingsErrors } | undefined;

const OWNERS_ONLY = "Only owners and managers can change online booking.";

async function owner() {
  const { supabase, staff: me } = await getCurrentStaff();
  return can(me, "settings") ? { supabase, me } : null;
}

// The rules and look of the salon's booking site, and its address.
export async function saveBookingSettings(_prev: BookingSettingsState, formData: FormData): Promise<BookingSettingsState> {
  const s = await owner();
  if (!s) return { ok: false, message: OWNERS_ONLY };
  const parsed = parseBookingSettings(formData);
  if (!parsed.ok) return { ok: false, message: "Fix the highlighted fields.", errors: parsed.errors };
  const { slug, ...settings } = parsed.value;
  if (settings.consultation_service_id && !isUuid(settings.consultation_service_id)) return { ok: false, message: "Choose a consultation service." };

  const { error: slugError } = await s.supabase.from("businesses").update({ slug }).eq("id", s.me.business_id);
  if (slugError?.code === "23505") return { ok: false, message: "Fix the highlighted fields.", errors: { slug: "Another salon has this address. Try another." } };
  if (slugError) throw slugError;
  const { error } = await s.supabase.from("online_booking_settings").upsert({ business_id: s.me.business_id, ...settings });
  if (error?.code === "23503") return { ok: false, message: "That consultation service no longer exists." };
  if (error) throw error;
  revalidatePath("/settings/booking");
  return { ok: true, message: settings.enabled ? "Saved. Online booking is on." : "Saved. Online booking is off." };
}

// How each service is booked online, and its deposit. Fields per service:
// mode_<id>, deposit_kind_<id>, deposit_<id>.
export async function saveServicesOnline(_prev: BookingSettingsState, formData: FormData): Promise<BookingSettingsState> {
  const s = await owner();
  if (!s) return { ok: false, message: OWNERS_ONLY };
  const ids = formData.getAll("service").map(String).filter(isUuid);
  const updates = [];
  for (const id of ids) {
    const parsed = parseServiceOnline(String(formData.get(`mode_${id}`) ?? ""), String(formData.get(`deposit_kind_${id}`) ?? ""), String(formData.get(`deposit_${id}`) ?? ""));
    if (!parsed.ok) {
      const { data } = await s.supabase.from("services").select("name").eq("id", id).single();
      return { ok: false, message: `${data?.name ?? "A service"}: ${parsed.error}` };
    }
    updates.push({ id, ...parsed.value });
  }
  const results = await Promise.all(updates.map(({ id, ...u }) => s.supabase.from("services").update(u).eq("id", id).eq("business_id", s.me.business_id)));
  for (const r of results) if (r.error) throw r.error;
  revalidatePath("/settings/booking");
  return { ok: true, message: "Saved the services." };
}
