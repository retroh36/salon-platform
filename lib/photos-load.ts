// Loading before and after photos with short-lived signed links (the
// bucket is private). Staff pages only, with the signed-in user's client,
// so storage and table RLS both apply.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { toLocal } from "@/lib/scheduling/time";
import { PHOTO_BUCKET, PHOTO_URL_SECONDS, type PhotoKind, type PhotoView } from "./photos";

type Supabase = SupabaseClient<Database>;

export type PhotoConsent = { on: string | null; by: string | null };

export async function loadPhotos(
  supabase: Supabase,
  me: { id: string; role: string; location: { timezone: string } },
  where: { clientId: string } | { appointmentId: string },
): Promise<{ photos: PhotoView[]; consent: PhotoConsent; clientId: string | null }> {
  let query = supabase
    .from("visit_photos")
    .select("id, kind, storage_path, marketing_ok, created_by, client_id, appointment_id, stylist:staff!visit_photos_staff_id_fkey(first_name), appointment:appointments(starts_at)")
    .order("created_at");
  query = "clientId" in where ? query.eq("client_id", where.clientId) : query.eq("appointment_id", where.appointmentId);
  const { data, error } = await query;
  if (error) throw error;

  let clientId: string | null = "clientId" in where ? where.clientId : (data[0]?.client_id ?? null);
  if (!clientId && "appointmentId" in where) {
    const { data: a } = await supabase.from("appointments").select("client_id").eq("id", where.appointmentId).maybeSingle();
    clientId = a?.client_id ?? null;
  }
  const consentRow = clientId
    ? (await supabase.from("clients").select("photo_consent_on, recorder:staff!clients_photo_consent_by_fkey(first_name)").eq("id", clientId).maybeSingle()).data
    : null;

  const signed = data.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(data.map((p) => p.storage_path), PHOTO_URL_SECONDS) : { data: [], error: null };
  if (signed.error) throw signed.error;
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const manager = me.role === "owner" || me.role === "manager";

  return {
    clientId,
    consent: { on: consentRow?.photo_consent_on ?? null, by: consentRow?.recorder?.first_name ?? null },
    photos: data
      .filter((p) => urls.get(p.storage_path))
      .map((p) => ({
        id: p.id,
        kind: p.kind as PhotoKind,
        url: urls.get(p.storage_path)!,
        takenOn: toLocal(new Date(p.appointment.starts_at), me.location.timezone).date,
        stylist: p.stylist?.first_name ?? null,
        marketingOk: p.marketing_ok,
        appointmentId: p.appointment_id,
        canDelete: manager || p.created_by === me.id,
      })),
  };
}
