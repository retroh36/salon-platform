// A client's own booking, found by the secret in their "manage my booking"
// link (only its hash is stored). Shows what they booked and nothing
// internal (no notes).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { VisitRequest } from "@/lib/scheduling/online";
import { sha256 } from "./security";
import type { BookingSite } from "./site";

export type ManagedBooking = {
  id: string;
  clientId: string;
  clientFirstName: string;
  status: string;
  // Kept as it is when rescheduling; never shown.
  notes: string | null;
  start: Date;
  end: Date;
  items: { serviceId: string; serviceName: string; staffId: string; staffName: string; start: Date; priceCents: number }[];
  depositCents: number;
  // The same services with the same stylist (or anyone, if they differ).
  request: VisitRequest;
};

export async function loadManaged(admin: SupabaseClient<Database>, site: BookingSite, token: string): Promise<ManagedBooking | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { data, error } = await admin
    .from("appointments")
    .select(
      "id, client_id, status, notes, starts_at, ends_at, deposit_cents, client:clients(first_name), appointment_items(service_id, staff_id, starts_at, price_cents, service:services(name), staff:staff(first_name))",
    )
    .eq("business_id", site.business.id)
    .eq("manage_token_hash", sha256(token))
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.client_id) return null;
  const items = [...data.appointment_items]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((i) => ({ serviceId: i.service_id, serviceName: i.service.name, staffId: i.staff_id, staffName: i.staff.first_name, start: new Date(i.starts_at), priceCents: i.price_cents }));
  const staffIds = [...new Set(items.map((i) => i.staffId))];
  return {
    id: data.id,
    clientId: data.client_id,
    clientFirstName: data.client?.first_name ?? "",
    status: data.status,
    notes: data.notes,
    start: new Date(data.starts_at),
    end: new Date(data.ends_at),
    items,
    depositCents: data.deposit_cents,
    request: {
      serviceIds: items.map((i) => i.serviceId),
      staffId: staffIds.length === 1 ? staffIds[0] : null,
      stylistIds: site.stylists.map((s) => s.id),
    },
  };
}

// Clients can cancel or reschedule online until the salon's cutoff.
export function canChange(site: BookingSite, booking: Pick<ManagedBooking, "status" | "start">, now = new Date()): boolean {
  return ["booked", "confirmed"].includes(booking.status) && booking.start.getTime() - now.getTime() >= site.settings.cancelCutoffHours * 3_600_000;
}
