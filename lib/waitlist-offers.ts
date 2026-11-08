// Waitlist offers (waitlist_offers): the salon's fixed message offering an
// opening to a waitlist client, sent only when staff tap Offer, and the
// client's link (/offer/<token>), by its token. Service role for the link.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { formatDay } from "./schedule-format.ts";
import { formatMinute, toLocal } from "./scheduling/time.ts";

type Admin = SupabaseClient<Database>;

// How long an offer is held for the client (never past 15 minutes before
// the time: create_waitlist_offer).
export const OFFER_MINUTES = 60;

export type WaitlistOffer = {
  id: string;
  businessId: string;
  location: { id: string; timezone: string };
  // The booking site, for the visit's manage link (none without one).
  slug: string | null;
  status: "open" | "taken" | "declined" | "canceled";
  expired: boolean;
  expiresAt: string;
  salon: { name: string; logoPath: string | null; accent: string | null };
  clientId: string;
  clientFirstName: string;
  clientLastName: string;
  staffId: string;
  stylist: string;
  startsAt: string;
  serviceIds: string[];
  services: string[];
  createdBy: string | null;
  appointmentId: string | null;
};

export const isOfferToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export async function loadOffer(admin: Admin, token: string): Promise<WaitlistOffer | null> {
  if (!isOfferToken(token)) return null;
  const { data: o, error } = await admin
    .from("waitlist_offers")
    .select(
      "id, business_id, status, expires_at, starts_at, staff_id, client_id, created_by, appointment_id, entry:waitlist_entries(service_ids), client:clients(first_name, last_name), staff:staff!waitlist_offers_staff_id_business_id_fkey(first_name), business:businesses(name, slug, logo_path, online_booking_settings(accent_color)), location:locations(id, timezone)",
    )
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  if (error) throw error;
  if (!o) return null;
  const serviceIds = o.entry.service_ids;
  const { data: services, error: sError } = await admin.from("services").select("id, name").in("id", serviceIds);
  if (sError) throw sError;
  return {
    id: o.id,
    businessId: o.business_id,
    location: o.location,
    slug: o.business.slug,
    status: o.status as WaitlistOffer["status"],
    expired: Date.parse(o.expires_at) <= Date.now(),
    expiresAt: o.expires_at,
    salon: { name: o.business.name, logoPath: o.business.logo_path, accent: o.business.online_booking_settings?.accent_color ?? null },
    clientId: o.client_id,
    clientFirstName: o.client.first_name,
    clientLastName: o.client.last_name,
    staffId: o.staff_id,
    stylist: o.staff.first_name,
    startsAt: o.starts_at,
    serviceIds,
    services: serviceIds.map((id) => services.find((s) => s.id === id)?.name ?? "").filter(Boolean),
    createdBy: o.created_by,
    appointmentId: o.appointment_id,
  };
}

// "Tue, Nov 10 at 2:15pm"
export function offerWhen(iso: string, timeZone: string): string {
  const local = toLocal(new Date(iso), timeZone);
  return `${formatDay(local.date)} at ${formatMinute(local.minute)}`;
}

// "Maple & Ash: Hi Ava, a spot opened up for your Balayage with Bridget on
// Tue, Nov 10 at 2:15pm. Take it or say no thanks here, by 1:15pm: …"
export function offerMessage(
  salon: string,
  firstName: string,
  services: readonly string[],
  stylist: string,
  when: string,
  until: string,
  url: string,
  channel: "sms" | "email",
): { subject: string | null; body: string } {
  return {
    subject: channel === "email" ? `A spot opened up at ${salon}` : null,
    body: `${salon}: Hi ${firstName}, a spot opened up for your ${services.join(" and ")} with ${stylist} on ${when}. Take it or say no thanks here, by ${until}: ${url}`,
  };
}

// The app notice to whoever sent it, in our words.
export function answerNotice(taken: boolean, client: string, stylist: string, when: string): string {
  return taken ? `${client} took the waitlist spot with ${stylist} on ${when}. It's booked.` : `${client} said no thanks to the waitlist spot with ${stylist} on ${when}.`;
}
