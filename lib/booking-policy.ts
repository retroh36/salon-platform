// What the cancellation policy asks of a booking before it's made, the same
// for every way staff book (the booking form, a series, Denise's chat, the
// waitlist, a group, a rebook at checkout) and the same rules as booking
// details and the booking site: a card on file (the salon's rule, or a
// repeat offender), and a deposit (the services' own, or a repeat
// offender's). And the consultation forms the visit will need that the
// client hasn't signed, to send by link once it's booked. With the staff
// member's own login (front of house).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { visitWarnings } from "./client-checks.ts";
import { depositFor, type DepositKind } from "./online-booking/settings.ts";
import { loadVisitPolicies } from "./policy-visits.ts";
import { formatPrice } from "./services.ts";

type Supabase = SupabaseClient<Database>;

export type BookingPolicy = {
  cardLabel: string | null;
  // Needed by the policy and not on file yet (a deposit always needs one).
  cardNeeded: boolean;
  depositCents: number;
  phone: string | null;
  // Forms to sign before the visit ("Color consent").
  forms: string[];
};

export type PolicyLine = { serviceId: string; staffId: string; priceCents: number };

// The services' own deposits for these lines, as the database works them
// out once it's booked (private.visit_service_deposit).
export async function serviceDeposit(supabase: Supabase, lines: readonly PolicyLine[]): Promise<number> {
  const ids = [...new Set(lines.map((l) => l.serviceId))];
  if (!ids.length) return 0;
  const { data, error } = await supabase.from("services").select("id, deposit_kind, deposit_amount").in("id", ids);
  if (error) throw error;
  const of = new Map(data.map((s) => [s.id, s]));
  return lines.reduce((sum, l) => {
    const s = of.get(l.serviceId);
    return sum + (s ? depositFor(s.deposit_kind as DepositKind, s.deposit_amount, l.priceCents) : 0);
  }, 0);
}

export async function policyForBooking(supabase: Supabase, businessId: string, role: string, clientId: string, lines: readonly PolicyLine[]): Promise<BookingPolicy | null> {
  if (!lines.length) return null;
  // The visit isn't booked yet: a stand-in id for it.
  const visitId = "00000000-0000-4000-8000-000000000000";
  const at = new Date();
  const now = at.toISOString();
  const [{ data: client }, deposit, checks] = await Promise.all([
    supabase.from("clients").select("phone").eq("id", clientId).maybeSingle(),
    serviceDeposit(supabase, lines),
    visitWarnings(supabase, businessId, [{ appointmentId: visitId, clientId, start: at, items: lines.map((l) => ({ serviceId: l.serviceId, start: at })) }]),
  ]);
  if (!client) return null;
  const forms = (checks.get(visitId)?.checklist ?? []).filter((c) => c.action.kind === "form" && !c.done).map((c) => c.label);
  const policies = await loadVisitPolicies(supabase, businessId, role, [
    {
      id: visitId,
      clientId,
      status: "booked",
      serviceIds: lines.map((l) => l.serviceId),
      staffIds: [...new Set(lines.map((l) => l.staffId))],
      visitCents: lines.reduce((n, l) => n + l.priceCents, 0),
      serviceDepositCents: deposit,
      depositPaidCents: 0,
      bookedAt: now,
      startsAt: now,
    },
  ]);
  const p = policies.get(visitId);
  if (!p) return null;
  return { cardLabel: p.cardLabel, cardNeeded: p.cardNeeded || p.depositNeededCents > 0, depositCents: p.depositNeededCents, phone: client.phone, forms };
}

// What a visit just booked still needs under the policy, said in the
// booking's own confirmation where there's no step before it (the
// waitlist, a group, a rebook at checkout): "Deposit needed: $50" or
// "Card needed to hold this booking", or null. Booking details has the
// link to send.
export async function policyNeedFor(supabase: Supabase, businessId: string, role: string, appointmentId: string): Promise<string | null> {
  const { data: a } = await supabase
    .from("appointments")
    .select("id, client_id, status, created_at, starts_at, deposit_cents, deposit_paid_cents, appointment_items(service_id, staff_id, price_cents)")
    .eq("id", appointmentId)
    .maybeSingle();
  if (!a?.client_id) return null;
  const policies = await loadVisitPolicies(supabase, businessId, role, [
    {
      id: a.id,
      clientId: a.client_id,
      status: a.status,
      serviceIds: a.appointment_items.map((i) => i.service_id),
      staffIds: [...new Set(a.appointment_items.map((i) => i.staff_id))],
      visitCents: a.appointment_items.reduce((n, i) => n + i.price_cents, 0),
      serviceDepositCents: a.deposit_cents,
      depositPaidCents: a.deposit_paid_cents,
      bookedAt: a.created_at,
      startsAt: a.starts_at,
    },
  ]);
  const p = policies.get(a.id);
  if (!p) return null;
  if (p.depositNeededCents > 0) return `Deposit needed: ${formatPrice(p.depositNeededCents)}`;
  return p.cardNeeded ? "Card needed to hold this booking" : null;
}
