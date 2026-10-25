"use server";

import { appointmentChannel } from "@/lib/messaging/send";
import { withStopLine } from "@/lib/messaging/templates";
import { hashKey, requestInfo, withinLimits } from "@/lib/online-booking/security";
import { loadSite } from "@/lib/online-booking/site";
import { PHOTO_MAX_BYTES, sniffImage } from "@/lib/photos";
import { fromLocal, isLocalDate, parseTime, todayIn } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";

export type InquiryInput = {
  kind: "wedding" | "event";
  date: string;
  readyBy: string;
  venue: string;
  inSalon: boolean;
  partySize: string;
  hair: boolean;
  makeup: boolean;
  notes: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  // Left empty by people; filled by bots.
  website: string;
};

export type InquiryResult = { ok: true; eventId: string; photoKey: string } | { ok: false; message: string };

// The key that lets this browser add photos to the inquiry it just sent
// (for an hour), without a login.
const photoKeyFor = (eventId: string) => hashKey(`event-photos:${eventId}`);

// An event inquiry from the booking site: checked, rate limited, saved as
// an Inquiry for the desk to open in the builder (save_event_inquiry, with
// the service role), and a fixed confirmation to the client by a channel
// they allow, through the outbox.
export async function sendInquiry(slug: string, input: InquiryInput): Promise<InquiryResult> {
  const admin = createAdminClient();
  const found = await loadSite(admin, slug);
  if (found.status !== "open") return { ok: false, message: "This salon isn't taking inquiries online." };
  const site = found.site;
  if (input.website) return { ok: false, message: "Something went wrong. Please call the salon." };
  const first = input.firstName.trim();
  const phone = input.phone.trim();
  const email = input.email.trim().toLowerCase();
  if (!first) return { ok: false, message: "Add your name." };
  if (!phone && !email) return { ok: false, message: "Add a phone number or email so we can reply." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Check your email address." };
  if (!isLocalDate(input.date) || input.date < todayIn(site.location.timezone)) return { ok: false, message: "Choose the date of the event." };
  const size = Number(input.partySize);
  if (!Number.isInteger(size) || size < 1 || size > 100) return { ok: false, message: "How many people need hair or makeup?" };
  const ready = input.readyBy ? parseTime(input.readyBy) : null;
  if (input.readyBy && ready == null) return { ok: false, message: "Check the ready-by time." };

  const { ipHash } = await requestInfo();
  const ok = await withinLimits(admin, [
    { key: `inquiry:ip:${ipHash}`, limit: 5, windowSeconds: 3600 },
    { key: `inquiry:contact:${hashKey(email || phone.replace(/\D/g, ""))}`, limit: 3, windowSeconds: 86400 },
  ]);
  if (!ok) return { ok: false, message: "We've had a few inquiries from you already. We'll be in touch, or call the salon." };

  const services = [input.hair && "hair", input.makeup && "makeup"].filter(Boolean).join(" and ");
  const { data: eventId, error } = await admin.rpc("save_event_inquiry", {
    p_business_id: site.business.id,
    p_input: {
      kind: input.kind,
      first_name: first,
      last_name: input.lastName.trim(),
      phone,
      email,
      event_date: input.date,
      ready_by: ready == null ? null : (fromLocal(input.date, ready, site.location.timezone)?.toISOString() ?? null),
      venue: input.inSalon ? "" : input.venue,
      on_location: !input.inSalon && Boolean(input.venue.trim()),
      party_size: size,
      services,
      notes: input.notes.slice(0, 2000),
    },
  });
  if (error) {
    if (error.code === "55000" || error.code === "22023") return { ok: false, message: `${error.message}.` };
    throw error;
  }

  const { data: event } = await admin.from("events").select("client_id").eq("id", eventId).single();
  const dest = event?.client_id ? await appointmentChannel(admin, event.client_id, email ? "email" : "sms") : null;
  if (dest) {
    const body = `Hi ${first}, thank you for your inquiry. ${site.business.name} has it and will be in touch soon to plan your ${input.kind === "wedding" ? "wedding" : "event"}.`;
    await admin.from("outbox_messages").insert({
      business_id: site.business.id,
      channel: dest.channel,
      to_address: dest.to,
      subject: dest.channel === "email" ? `Your inquiry to ${site.business.name}` : null,
      body: dest.channel === "sms" ? withStopLine(body) : body,
    });
  }
  return { ok: true, eventId, photoKey: photoKeyFor(eventId) };
}

// One inspiration photo (shrunk in the browser) for the inquiry just sent:
// up to six, within an hour of sending.
export async function addInquiryPhoto(eventId: string, photoKey: string, formData: FormData): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/.test(eventId) || photoKey !== photoKeyFor(eventId)) return { ok: false };
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0 || file.size > PHOTO_MAX_BYTES) return { ok: false };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return { ok: false };
  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("business_id, created_at, source").eq("id", eventId).maybeSingle();
  if (!event || event.source !== "online" || Date.now() - new Date(event.created_at).getTime() > 3600_000) return { ok: false };
  const { count } = await admin.from("event_photos").select("id", { count: "exact", head: true }).eq("event_id", eventId);
  if ((count ?? 0) >= 6) return { ok: false };
  const path = `${event.business_id}/${eventId}/${crypto.randomUUID()}.${type.ext}`;
  const upload = await admin.storage.from("event-photos").upload(path, bytes, { contentType: type.contentType, upsert: false });
  if (upload.error) return { ok: false };
  const { error } = await admin.rpc("add_inquiry_photos", { p_event_id: eventId, p_paths: [path] });
  if (error) {
    await admin.storage.from("event-photos").remove([path]);
    return { ok: false };
  }
  return { ok: true };
}
