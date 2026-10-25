// A proposal or a member's pay link (event_links), by its token: what the
// client's page shows and so what they agree to or pay. Service role.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { sha256 } from "@/lib/online-booking/security";
import { toLocal, todayIn } from "@/lib/scheduling/time";
import { headcountCutoff, memberShare, paymentSchedule, type ScheduledPayment } from "./pricing";
import { PARTY_ROLE_LABELS, settingsFrom, termsText, type PartyRole } from "./types";

type Admin = SupabaseClient<Database>;

export const isEventToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export type EventLink = {
  id: string;
  eventId: string;
  businessId: string;
  kind: "proposal" | "member" | "card";
  status: "open" | "done" | "canceled";
  expired: boolean;
  salon: { name: string; logoPath: string | null; accent: string | null };
  title: string;
  date: string;
  readyBy: number | null;
  startsAt: number | null;
  venue: string | null;
  onLocation: boolean;
  clientFirstName: string;
  party: { name: string; role: string; packageName: string; priceCents: number; paysOwn: boolean }[];
  totals: { subtotalCents: number; travelFeeCents: number; earlyFeeCents: number; serviceChargeCents: number; serviceChargePct: number; taxCents: number; totalCents: number; mainCents: number; depositCents: number };
  depositRefundable: boolean;
  schedule: ScheduledPayment[];
  cutoff: string;
  terms: { version: number; text: string } | null;
  // A member's own share.
  member: { name: string; packageName: string; priceCents: number; shareCents: number; paid: boolean } | null;
  // The proposal's state once agreed.
  agreedAs: string | null;
  // For a card link: what didn't go through and what's left.
  owed: { failedCents: number; leftCents: number; cardLabel: string | null } | null;
};

export async function loadEventLink(admin: Admin, token: string): Promise<EventLink | null> {
  if (!isEventToken(token)) return null;
  const { data: l, error } = await admin
    .from("event_links")
    .select(
      "id, kind, status, expires_at, member_id, terms:event_terms(version, body), event:events(id, business_id, title, status, card_label, event_date, ready_by, venue_name, on_location, subtotal_cents, travel_fee_cents, early_fee_cents, service_charge_cents, tax_cents, total_cents, main_cents, deposit_cents, client:clients(first_name), location:locations(timezone), business:businesses(name, logo_path, tax_rate_services_bp, online_booking_settings(accent_color)), members:event_members(id, position, name, party_role, package_name, price_cents, pays_own), tasks:event_tasks(starts_at))",
    )
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (error) throw error;
  if (!l) return null;
  const e = l.event;
  const tz = e.location.timezone;
  const [{ data: s }, { data: agreement }, { data: memberPaid }, { data: payments }] = await Promise.all([
    admin.from("event_settings").select("*").eq("business_id", e.business_id).single(),
    l.kind === "proposal" ? admin.from("event_agreements").select("typed_name").eq("link_id", l.id).maybeSingle() : Promise.resolve({ data: null }),
    l.member_id ? admin.from("event_payments").select("id").eq("member_id", l.member_id).eq("status", "paid").limit(1) : Promise.resolve({ data: [] }),
    l.kind === "card" ? admin.from("event_payments").select("amount_cents, status").eq("event_id", e.id).neq("kind", "member") : Promise.resolve({ data: [] }),
  ]);
  const sum = (status: string) => (payments ?? []).filter((p) => p.status === status).reduce((a, p) => a + p.amount_cents, 0);
  const settings = settingsFrom(s!);
  const minute = (iso: string) => toLocal(new Date(iso), tz).minute;
  const members = [...e.members].sort((a, b) => a.position - b.position);
  const member = l.member_id ? members.find((m) => m.id === l.member_id) : null;
  const firstStart = e.tasks.length ? Math.min(...e.tasks.map((t) => Date.parse(t.starts_at))) : null;
  return {
    id: l.id,
    eventId: e.id,
    businessId: e.business_id,
    kind: l.kind as EventLink["kind"],
    status: l.status as EventLink["status"],
    expired: Date.parse(l.expires_at) <= Date.now(),
    salon: { name: e.business.name, logoPath: e.business.logo_path, accent: e.business.online_booking_settings?.accent_color ?? null },
    title: e.title,
    date: e.event_date,
    readyBy: e.ready_by ? minute(e.ready_by) : null,
    startsAt: firstStart == null ? null : minute(new Date(firstStart).toISOString()),
    venue: e.venue_name,
    onLocation: e.on_location,
    clientFirstName: e.client?.first_name ?? "",
    party: members.map((m) => ({ name: m.name, role: PARTY_ROLE_LABELS[m.party_role as PartyRole], packageName: m.package_name, priceCents: m.price_cents, paysOwn: m.pays_own })),
    totals: {
      subtotalCents: e.subtotal_cents,
      travelFeeCents: e.travel_fee_cents,
      earlyFeeCents: e.early_fee_cents,
      serviceChargeCents: e.service_charge_cents,
      serviceChargePct: settings.serviceChargePct,
      taxCents: e.tax_cents,
      totalCents: e.total_cents,
      mainCents: e.main_cents,
      depositCents: e.deposit_cents,
    },
    depositRefundable: settings.depositRefundable,
    schedule: paymentSchedule({ mainCents: e.main_cents, depositCents: e.deposit_cents, eventDate: e.event_date, bookedOn: todayIn(tz) }, settings),
    cutoff: headcountCutoff(e.event_date, settings),
    terms: l.terms ? { version: l.terms.version, text: termsText(l.terms.body, e.business.name) } : null,
    member: member ? { name: member.name, packageName: member.package_name, priceCents: member.price_cents, shareCents: memberShare(member.price_cents, settings, e.business.tax_rate_services_bp), paid: (memberPaid ?? []).length > 0 } : null,
    agreedAs: agreement?.typed_name ?? null,
    owed: l.kind === "card" ? { failedCents: sum("failed"), leftCents: e.main_cents - sum("paid"), cardLabel: e.card_label } : null,
  };
}
