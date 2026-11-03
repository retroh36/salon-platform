"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { LOGO_BUCKET, MAX_LOGO_BYTES } from "@/lib/branding";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { sniffImage } from "@/lib/photos";
import { BIO_MAX, DESCRIPTION_MAX, PORTFOLIO_MAX, SERVICE_DESCRIPTION_MAX, SPECIALTY_MAX } from "@/lib/online-booking/profile";

// Settings → Booking page: the cover photo and description at the top of
// the booking site, each stylist's portrait, specialty, bio and portfolio,
// and service descriptions and category photos. Everything here is shown
// to the public on the booking site. Photos go to the public buckets the
// site already uses, under the business id (storage policies check it).

export type PageResult = { ok: boolean; message: string };

const SETTINGS_ONLY = "Only owners and managers with Settings can change the booking page.";
const TEAM_ONLY = "Only owners, and managers who manage the team, can change stylists' profiles.";
const STAFF_BUCKET = "staff-photos";

async function owner() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && can(me, "settings") ? { supabase, me } : null;
}

function done(message: string): PageResult {
  revalidatePath("/settings/booking-page");
  return { ok: true, message };
}

// The photo sent (shrunk to a JPEG in the browser), checked by its bytes.
async function photoOf(formData: FormData): Promise<{ bytes: Uint8Array; ext: string; contentType: string } | string> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return "Choose a photo.";
  if (file.size > MAX_LOGO_BYTES) return "Use a photo up to 2 MB.";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  return type ? { bytes, ext: type.ext, contentType: type.contentType } : "Use a JPEG, PNG or WebP photo.";
}

async function upload(supabase: Awaited<ReturnType<typeof getCurrentStaff>>["supabase"], bucket: string, path: string, photo: { bytes: Uint8Array; contentType: string }) {
  const { error } = await supabase.storage.from(bucket).upload(path, photo.bytes, { contentType: photo.contentType, upsert: false });
  return !error;
}

// The short description under the salon's name (the welcome line).
export async function saveDescription(text: string): Promise<PageResult> {
  const s = await owner();
  if (!s) return { ok: false, message: SETTINGS_ONLY };
  const welcome = text.trim();
  if (welcome.length > DESCRIPTION_MAX) return { ok: false, message: `Keep it under ${DESCRIPTION_MAX} characters.` };
  const { error } = await s.supabase.from("online_booking_settings").upsert({ business_id: s.me.business_id, welcome: welcome || null });
  if (error) throw error;
  return done("Saved the description.");
}

export async function uploadCover(formData: FormData): Promise<PageResult> {
  const s = await owner();
  if (!s) return { ok: false, message: SETTINGS_ONLY };
  const photo = await photoOf(formData);
  if (typeof photo === "string") return { ok: false, message: photo };
  const path = `${s.me.business_id}/cover-${Date.now()}.${photo.ext}`;
  if (!(await upload(s.supabase, LOGO_BUCKET, path, photo))) return { ok: false, message: "Couldn't upload that photo. Try again." };
  const { data: before } = await s.supabase.from("online_booking_settings").select("cover_path").eq("business_id", s.me.business_id).maybeSingle();
  const { error } = await s.supabase.from("online_booking_settings").upsert({ business_id: s.me.business_id, cover_path: path });
  if (error) throw error;
  if (before?.cover_path) await s.supabase.storage.from(LOGO_BUCKET).remove([before.cover_path]);
  return done("Saved the cover photo.");
}

export async function removeCover(): Promise<PageResult> {
  const s = await owner();
  if (!s) return { ok: false, message: SETTINGS_ONLY };
  const { data: before } = await s.supabase.from("online_booking_settings").select("cover_path").eq("business_id", s.me.business_id).maybeSingle();
  const { error } = await s.supabase.from("online_booking_settings").update({ cover_path: null }).eq("business_id", s.me.business_id);
  if (error) throw error;
  if (before?.cover_path) await s.supabase.storage.from(LOGO_BUCKET).remove([before.cover_path]);
  return done("Removed the cover photo.");
}

// A stylist's one-line specialty and short bio.
export async function saveProfile(staffId: string, fields: { specialty: string; bio: string }): Promise<PageResult> {
  const s = await owner();
  if (!s || !isUuid(staffId)) return { ok: false, message: SETTINGS_ONLY };
  const specialty = fields.specialty.trim();
  const bio = fields.bio.trim();
  if (specialty.length > SPECIALTY_MAX) return { ok: false, message: `Keep the specialty under ${SPECIALTY_MAX} characters.` };
  if (bio.length > BIO_MAX) return { ok: false, message: `Keep the bio under ${BIO_MAX} characters.` };
  const { data, error } = await s.supabase.from("staff").update({ specialty: specialty || null, bio: bio || null }).eq("id", staffId).select("first_name");
  if (error) throw error;
  if (!data.length) return { ok: false, message: TEAM_ONLY };
  return done(`Saved ${data[0].first_name}'s profile.`);
}

// Their portrait (the same photo Team → Schedule sets).
export async function uploadPortrait(staffId: string, formData: FormData): Promise<PageResult> {
  const s = await owner();
  if (!s || !isUuid(staffId)) return { ok: false, message: SETTINGS_ONLY };
  const photo = await photoOf(formData);
  if (typeof photo === "string") return { ok: false, message: photo };
  const { data: before } = await s.supabase.from("staff").select("photo_path").eq("id", staffId).single();
  const path = `${s.me.business_id}/staff-${staffId.slice(0, 8)}-${Date.now()}.${photo.ext}`;
  if (!(await upload(s.supabase, STAFF_BUCKET, path, photo))) return { ok: false, message: TEAM_ONLY };
  const { data, error } = await s.supabase.from("staff").update({ photo_path: path }).eq("id", staffId).select("id");
  if (error) throw error;
  if (!data.length) {
    await s.supabase.storage.from(STAFF_BUCKET).remove([path]);
    return { ok: false, message: TEAM_ONLY };
  }
  if (before?.photo_path) await s.supabase.storage.from(STAFF_BUCKET).remove([before.photo_path]);
  revalidatePath("/schedule");
  return done("Saved the portrait.");
}

export async function removePortrait(staffId: string): Promise<PageResult> {
  const s = await owner();
  if (!s || !isUuid(staffId)) return { ok: false, message: SETTINGS_ONLY };
  const { data: before } = await s.supabase.from("staff").select("photo_path").eq("id", staffId).single();
  const { data, error } = await s.supabase.from("staff").update({ photo_path: null }).eq("id", staffId).select("id");
  if (error) throw error;
  if (!data.length) return { ok: false, message: TEAM_ONLY };
  if (before?.photo_path) await s.supabase.storage.from(STAFF_BUCKET).remove([before.photo_path]);
  revalidatePath("/schedule");
  return done("Removed the portrait. Their initials show instead.");
}

// Up to three photos of their work.
export async function addPortfolioPhoto(staffId: string, formData: FormData): Promise<PageResult> {
  const s = await owner();
  if (!s || !isUuid(staffId)) return { ok: false, message: SETTINGS_ONLY };
  const { data: before } = await s.supabase.from("staff").select("portfolio_paths").eq("id", staffId).single();
  if (!before) return { ok: false, message: TEAM_ONLY };
  if (before.portfolio_paths.length >= PORTFOLIO_MAX) return { ok: false, message: `Up to ${PORTFOLIO_MAX} photos. Remove one first.` };
  const photo = await photoOf(formData);
  if (typeof photo === "string") return { ok: false, message: photo };
  const path = `${s.me.business_id}/work-${staffId.slice(0, 8)}-${Date.now()}.${photo.ext}`;
  if (!(await upload(s.supabase, STAFF_BUCKET, path, photo))) return { ok: false, message: TEAM_ONLY };
  const { data, error } = await s.supabase
    .from("staff")
    .update({ portfolio_paths: [...before.portfolio_paths, path] })
    .eq("id", staffId)
    .select("id");
  if (error?.code === "23514") {
    await s.supabase.storage.from(STAFF_BUCKET).remove([path]);
    return { ok: false, message: `Up to ${PORTFOLIO_MAX} photos. Remove one first.` };
  }
  if (error) throw error;
  if (!data.length) {
    await s.supabase.storage.from(STAFF_BUCKET).remove([path]);
    return { ok: false, message: TEAM_ONLY };
  }
  return done("Added the photo.");
}

export async function removePortfolioPhoto(staffId: string, path: string): Promise<PageResult> {
  const s = await owner();
  if (!s || !isUuid(staffId)) return { ok: false, message: SETTINGS_ONLY };
  const { data: before } = await s.supabase.from("staff").select("portfolio_paths").eq("id", staffId).single();
  if (!before?.portfolio_paths.includes(path)) return { ok: false, message: "That photo has already gone." };
  const { data, error } = await s.supabase
    .from("staff")
    .update({ portfolio_paths: before.portfolio_paths.filter((p) => p !== path) })
    .eq("id", staffId)
    .select("id");
  if (error) throw error;
  if (!data.length) return { ok: false, message: TEAM_ONLY };
  await s.supabase.storage.from(STAFF_BUCKET).remove([path]);
  return done("Removed the photo.");
}

// One photo for each category of the menu.
export async function uploadCategoryPhoto(category: string, formData: FormData): Promise<PageResult> {
  const s = await owner();
  if (!s || !category.trim()) return { ok: false, message: SETTINGS_ONLY };
  const photo = await photoOf(formData);
  if (typeof photo === "string") return { ok: false, message: photo };
  const path = `${s.me.business_id}/category-${Date.now()}.${photo.ext}`;
  if (!(await upload(s.supabase, LOGO_BUCKET, path, photo))) return { ok: false, message: SETTINGS_ONLY };
  const { data: before } = await s.supabase.from("service_category_photos").select("photo_path").eq("business_id", s.me.business_id).eq("category", category).maybeSingle();
  const { error } = await s.supabase
    .from("service_category_photos")
    .upsert({ business_id: s.me.business_id, category, photo_path: path, updated_at: new Date().toISOString() });
  if (error) throw error;
  if (before) await s.supabase.storage.from(LOGO_BUCKET).remove([before.photo_path]);
  return done(`Saved the photo for ${category}.`);
}

export async function removeCategoryPhoto(category: string): Promise<PageResult> {
  const s = await owner();
  if (!s) return { ok: false, message: SETTINGS_ONLY };
  const { data, error } = await s.supabase.from("service_category_photos").delete().eq("business_id", s.me.business_id).eq("category", category).select("photo_path");
  if (error) throw error;
  if (data.length) await s.supabase.storage.from(LOGO_BUCKET).remove(data.map((d) => d.photo_path));
  return done(`Removed the photo for ${category}.`);
}

// Services' short descriptions (the same ones the Services page edits),
// saved together.
export async function saveServiceDescriptions(entries: { id: string; description: string }[]): Promise<PageResult> {
  const s = await owner();
  if (!s || !entries.every((e) => isUuid(e.id))) return { ok: false, message: SETTINGS_ONLY };
  const long = entries.find((e) => e.description.trim().length > SERVICE_DESCRIPTION_MAX);
  if (long) return { ok: false, message: `Keep each description under ${SERVICE_DESCRIPTION_MAX} characters.` };
  const results = await Promise.all(
    entries.map((e) => s.supabase.from("services").update({ description: e.description.trim() || null }).eq("id", e.id).eq("business_id", s.me.business_id).select("id")),
  );
  for (const r of results) if (r.error) throw r.error;
  if (results.some((r) => !r.data!.length)) return { ok: false, message: SETTINGS_ONLY };
  return done(entries.length === 1 ? "Saved the description." : "Saved the descriptions.");
}
