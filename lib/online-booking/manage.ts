// A client's own booking, found by the secret in their "manage my booking"
// link (only its hash is stored). Shows what they booked and nothing
// internal (no notes).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { cancelFee, policyText, visitTerms } from "@/lib/policy";
import { loadPolicy } from "@/lib/policy-load";
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
  // Paid ahead (online or by a card link).
  depositPaidCents: number;
  bookedAt: Date;
  // The same services with the same stylist (or anyone, if they differ).
  request: VisitRequest;
};

export async function loadManaged(admin: SupabaseClient<Database>, site: BookingSite, token: string): Promise<ManagedBooking | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { data, error } = await admin
    .from("appointments")
    .select(
      "id, client_id, status, notes, starts_at, ends_at, created_at, deposit_cents, deposit_paid_cents, client:clients(first_name), appointment_items(service_id, staff_id, starts_at, price_cents, service:services(name), staff:staff(first_name))",
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
    depositPaidCents: data.deposit_paid_cents,
    bookedAt: new Date(data.created_at),
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

// What canceling now would cost under the salon's policy (the database
// works out the same when it's canceled), and the policy as it reads for
// this visit.
export async function cancelTerms(admin: SupabaseClient<Database>, site: BookingSite, booking: ManagedBooking, now = new Date()): Promise<{ feeCents: number; lines: string[]; cardLabel: string | null }> {
  const policy = await loadPolicy(admin, site.business.id);
  const staffIds = new Set(booking.items.map((i) => i.staffId));
  const stylists = policy.stylists.filter((p) => staffIds.has(p.staffId));
  const visitCents = booking.items.reduce((sum, i) => sum + i.priceCents, 0);
  const terms = visitTerms(policy.settings, stylists, visitCents, booking.depositPaidCents);
  const { feeCents } = cancelFee(terms, { startsAt: booking.start, bookedAt: booking.bookedAt, depositPaidCents: booking.depositPaidCents }, now, "Canceled online by the client");
  const { data: card } = await admin.from("client_cards").select("label").eq("client_id", booking.clientId).is("removed_at", null).maybeSingle();
  return {
    feeCents,
    lines: policyText(policy.settings, { stylists, visitCents, depositCents: booking.depositPaidCents, extra: policy.extra, salon: site.business.name }),
    cardLabel: card?.label ?? null,
  };
}
