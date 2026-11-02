// Short booking links (/b/<code>): a special's text links to the booking
// site with the stylist and services chosen, in a few characters rather
// than their ids. The code comes from what it links to, so the preview on
// Promotions and the message sent say the same link; it's saved
// (booking_links) when the message is sent.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { siteUrl } from "@/lib/branding";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

export type BookingLink = { businessId: string; staffId: string | null; serviceIds: string[]; source: string };

export function linkCode(link: BookingLink): string {
  const key = [link.businessId, link.staffId ?? "", [...link.serviceIds].sort().join(","), link.source].join("|");
  const bytes = createHash("sha256").update(key).digest();
  return Array.from(bytes.subarray(0, CODE_LENGTH), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const shortLink = (link: BookingLink) => `${siteUrl()}/b/${linkCode(link)}`;

// Where a code goes: the salon's booking site with the same choices.
export function bookingPath(slug: string, row: { staff_id: string | null; service_ids: string[]; source: string }): string {
  const q = new URLSearchParams({ src: row.source });
  if (row.staff_id) q.set("staff", row.staff_id);
  if (row.service_ids.length) q.set("services", row.service_ids.join(","));
  return `/book/${slug}?${q.toString().replaceAll("%2C", ",")}`;
}

// Saved as the staff member sending it; a link already there stays as it is.
export async function saveBookingLink(supabase: SupabaseClient<Database>, staffId: string, link: BookingLink): Promise<void> {
  const { error } = await supabase.from("booking_links").upsert(
    { code: linkCode(link), business_id: link.businessId, staff_id: link.staffId, service_ids: link.serviceIds.slice(0, 4), source: link.source, created_by: staffId },
    { onConflict: "code", ignoreDuplicates: true },
  );
  if (error) throw error;
}
