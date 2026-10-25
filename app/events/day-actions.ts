"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { loadEventSettings } from "@/lib/events/load";
import { isUuid } from "@/lib/ids";
import { sniffImage } from "@/lib/photos";
import { describeProblem } from "@/lib/scheduling/booking";
import { saveBooking } from "@/lib/scheduling/book";
import { loadBookingContext } from "@/lib/scheduling/load";
import { findOpenings } from "@/lib/scheduling/openings";
import { formatMinute, isLocalDate, todayIn } from "@/lib/scheduling/time";
import { isFrontOfHouse } from "@/lib/staff";

export type DayResult = { ok: true; message: string } | { ok: false; message: string };

const EVENT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

async function desk() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && isFrontOfHouse(me.role) ? { supabase, me } : null;
}

export type TrialTime = { staffId: string; firstName: string; start: string; label: string };

// Free times for the trial on a day: the salon's trial service with the
// event's hair team first (anyone who does the service otherwise), by the
// booking rules.
export async function trialTimes(eventId: string, date: string): Promise<{ ok: true; times: TrialTime[] } | { ok: false; message: string }> {
  const s = await desk();
  if (!s || !isUuid(eventId) || !isLocalDate(date)) return { ok: false, message: "Only the front desk, managers and owners can book trials." };
  const settings = await loadEventSettings(s.supabase, s.me.business_id);
  if (!settings.trialServiceId) return { ok: false, message: "Choose the trial service on Settings → Bridal and events first." };
  const tz = s.me.location.timezone;
  if (date < todayIn(tz)) return { ok: false, message: "Choose a day that hasn't passed." };
  const [{ data: tasks }, ctx, { data: staff }] = await Promise.all([
    s.supabase.from("event_tasks").select("staff_id").eq("event_id", eventId).eq("role", "hair").not("staff_id", "is", null),
    loadBookingContext(s.supabase, s.me.location, date, date),
    s.supabase.from("staff").select("id, first_name").eq("location_id", s.me.location.id),
  ]);
  const team = [...new Set((tasks ?? []).map((t) => t.staff_id!))];
  const name = new Map((staff ?? []).map((m) => [m.id, m.first_name]));
  const query = { serviceId: settings.trialServiceId, date, step: 15, notBefore: new Date(), limit: 12 };
  let openings = team.length ? findOpenings(ctx, { ...query, staffIds: team }) : [];
  if (!openings.length) openings = findOpenings(ctx, query);
  return {
    ok: true,
    times: openings.map((o) => ({ staffId: o.staffId, firstName: name.get(o.staffId) ?? "", start: o.start.toISOString(), label: `${formatMinute(o.startMinute)} with ${name.get(o.staffId) ?? "a stylist"}` })),
  };
}

// The trial booked like any visit (saveBooking checks the rules again),
// then linked to the event.
export async function bookTrial(eventId: string, staffId: string, start: string): Promise<DayResult> {
  const s = await desk();
  if (!s || !isUuid(eventId) || !isUuid(staffId) || Number.isNaN(Date.parse(start))) return { ok: false, message: "Only the front desk, managers and owners can book trials." };
  const [settings, { data: event }] = await Promise.all([
    loadEventSettings(s.supabase, s.me.business_id),
    s.supabase.from("events").select("client_id, title").eq("id", eventId).maybeSingle(),
  ]);
  if (!event?.client_id) return { ok: false, message: "We couldn't find this event's client." };
  if (!settings.trialServiceId) return { ok: false, message: "Choose the trial service on Settings → Bridal and events first." };
  const saved = await saveBooking(s.supabase, s.me.location, {
    clientId: event.client_id,
    notes: `Trial for ${event.title}`,
    items: [{ serviceId: settings.trialServiceId, staffId, resource: { kind: "any" }, start: new Date(start) }],
  });
  if (!saved.ok) {
    if (saved.error === "invalid") return { ok: false, message: describeProblem(saved.problems.flat()[0]) };
    return { ok: false, message: saved.error === "busy" ? "The calendar is busy. Try again." : "That time can't be booked." };
  }
  const { error } = await s.supabase.rpc("link_event_trial", { p_event_id: eventId, p_appointment_id: saved.appointmentId });
  if (error) throw error;
  revalidatePath(`/events/${eventId}`);
  return { ok: true, message: "Trial booked." };
}

// The look: notes (front of house and stylists on the event).
export async function saveLook(eventId: string, notes: string): Promise<DayResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(eventId)) return { ok: false, message: "Couldn't save the notes." };
  const { error } = await supabase.rpc("save_event_look", { p_event_id: eventId, p_notes: notes.slice(0, 4000) });
  if (error) return { ok: false, message: error.code === "P0002" ? "You can't change this event." : "Couldn't save the notes." };
  return { ok: true, message: "Saved." };
}

// A photo of the look (shrunk in the browser): the file to
// <business>/<event>/<id>.<ext>, then its row.
export async function addLookPhoto(eventId: string, formData: FormData): Promise<DayResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(eventId)) return { ok: false, message: "Couldn't save that photo." };
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a photo." };
  if (file.size > EVENT_PHOTO_MAX_BYTES) return { ok: false, message: "That photo is too large. Try another." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return { ok: false, message: "Use a JPEG, PNG or WebP photo." };
  const path = `${me.business_id}/${eventId}/${crypto.randomUUID()}.${type.ext}`;
  const upload = await supabase.storage.from("event-photos").upload(path, bytes, { contentType: type.contentType, upsert: false });
  if (upload.error) return { ok: false, message: "Couldn't upload that photo. Try again." };
  const { error } = await supabase.rpc("add_event_photo", { p_event_id: eventId, p_path: path });
  if (error) {
    await supabase.storage.from("event-photos").remove([path]);
    return { ok: false, message: error.code === "22023" ? `${error.message}.` : "Couldn't save that photo." };
  }
  revalidatePath(`/events/${eventId}`);
  return { ok: true, message: "Photo saved." };
}

// The event's done: one sale, so the work flows into commission, tips and
// payroll (complete_event).
export async function completeEvent(eventId: string): Promise<DayResult> {
  const s = await desk();
  if (!s || !isUuid(eventId)) return { ok: false, message: "Only the front desk, managers and owners can complete events." };
  const { data, error } = await s.supabase.rpc("complete_event", { p_event_id: eventId });
  if (error) {
    if (["55000", "42501"].includes(error.code ?? "")) return { ok: false, message: `${error.message}.` };
    throw error;
  }
  const { data: sale } = await s.supabase.from("sales").select("number").eq("id", data).single();
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  return { ok: true, message: `Completed. Sale #${sale?.number} is in today's sales and payroll.` };
}
