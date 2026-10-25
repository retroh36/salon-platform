"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { PHOTO_BUCKET, PHOTO_KINDS, PHOTO_MAX_BYTES, photoPath, sniffImage, type PhotoKind, type PhotoView } from "@/lib/photos";
import { loadPhotos, type PhotoConsent } from "@/lib/photos-load";
import { isLocalDate } from "@/lib/scheduling/time";

export type PhotoResult = { ok: true; message: string } | { ok: false; message: string };

// A visit's photos, for booking details' Photos tab.
export async function visitPhotos(appointmentId: string): Promise<{ photos: PhotoView[]; consent: PhotoConsent; clientId: string | null } | null> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(appointmentId)) return null;
  return loadPhotos(supabase, me, { appointmentId });
}

// A photo (already shrunk in the browser) saved to the visit: the file to
// <business>/<client>/<id>.<ext>, then its row. The file's type comes from
// its bytes.
export async function addVisitPhoto(appointmentId: string, kind: PhotoKind, formData: FormData): Promise<PhotoResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(appointmentId) || !PHOTO_KINDS.includes(kind)) return { ok: false, message: "Couldn't save that photo." };
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a photo." };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, message: "That photo is too large. Try another." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return { ok: false, message: "Use a JPEG, PNG or WebP photo." };

  const { data: visit } = await supabase.from("appointments").select("client_id, business_id").eq("id", appointmentId).maybeSingle();
  if (!visit) return { ok: false, message: "Couldn't find that visit." };
  if (!visit.client_id) return { ok: false, message: "Photos are saved to a client; this visit has none." };
  const path = photoPath(visit.business_id, visit.client_id, crypto.randomUUID(), type.ext);
  const upload = await supabase.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: type.contentType, upsert: false });
  if (upload.error) return { ok: false, message: "Couldn't upload that photo. Try again." };
  const { error } = await supabase.rpc("add_visit_photo", { p_appointment_id: appointmentId, p_kind: kind, p_path: path });
  if (error) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    if (error.code === "42501") return { ok: false, message: "You can't add photos to this visit." };
    // Our own messages are written for staff; anything else is logged, not shown.
    if (error.code === "22023") return { ok: false, message: error.message };
    console.error(`[photos] couldn't save a photo: ${error.code ?? "?"} ${error.message}`);
    return { ok: false, message: "Couldn't save that photo. Try again." };
  }
  revalidatePath(`/clients/${visit.client_id}`);
  return { ok: true, message: kind === "before" ? "Before photo saved." : "After photo saved." };
}

export async function deleteVisitPhoto(photoId: string): Promise<PhotoResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(photoId)) return { ok: false, message: "Couldn't remove that photo." };
  const { data: row } = await supabase.from("visit_photos").select("client_id").eq("id", photoId).maybeSingle();
  const { data: path, error } = await supabase.rpc("delete_visit_photo", { p_photo_id: photoId });
  if (error?.code === "42501") return { ok: false, message: "Only whoever added it, or a manager, can remove a photo." };
  if (error) throw error;
  await supabase.storage.from(PHOTO_BUCKET).remove([path]);
  if (row) revalidatePath(`/clients/${row.client_id}`);
  return { ok: true, message: "Photo removed." };
}

export async function setPhotoMarketing(photoId: string, ok: boolean): Promise<PhotoResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(photoId)) return { ok: false, message: "Couldn't change that photo." };
  const { error } = await supabase.rpc("set_photo_marketing", { p_photo_id: photoId, p_ok: ok });
  if (error?.hint === "photo_consent") return { ok: false, message: "Record the client's consent first." };
  if (error) throw error;
  const { data: row } = await supabase.from("visit_photos").select("client_id").eq("id", photoId).maybeSingle();
  if (row) revalidatePath(`/clients/${row.client_id}`);
  return { ok: true, message: ok ? "OK to use in marketing." : "Not for marketing." };
}

// Consent on a date, or withdrawn (null), which takes every photo of
// theirs out of marketing.
export async function setPhotoConsent(clientId: string, on: string | null): Promise<PhotoResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(clientId)) return { ok: false, message: "Couldn't record that." };
  if (on !== null && !isLocalDate(on)) return { ok: false, message: "Enter the date they gave consent." };
  const { error } = await supabase.rpc("set_photo_consent", { p_client_id: clientId, p_on: on as string });
  if (error?.code === "22023") return { ok: false, message: error.message };
  if (error) throw error;
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: on ? "Consent recorded." : "Consent withdrawn. Their photos aren't used in marketing." };
}
