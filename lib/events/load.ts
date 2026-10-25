// Loading events and what the builder needs (server, with the signed-in
// person's client: RLS keeps it to their salon, and stylists to events
// they're on).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { toLocal } from "@/lib/scheduling/time";
import { settingsFrom, type EventPackage, type EventSettings, type EventStatus, type PartyRole } from "./types";

type Client = SupabaseClient<Database>;

const PACKAGE_COLUMNS = "id, name, party_role, hair_minutes, makeup_minutes, price_cents, is_trial, is_active";

export function packageFrom(p: { id: string; name: string; party_role: PartyRole | null; hair_minutes: number; makeup_minutes: number; price_cents: number; is_trial: boolean; is_active: boolean }): EventPackage {
  return { id: p.id, name: p.name, partyRole: p.party_role, hairMinutes: p.hair_minutes, makeupMinutes: p.makeup_minutes, priceCents: p.price_cents, isTrial: p.is_trial, isActive: p.is_active };
}

export async function loadPackages(supabase: Client, businessId: string): Promise<EventPackage[]> {
  const { data, error } = await supabase.from("event_packages").select(PACKAGE_COLUMNS).eq("business_id", businessId).order("position").order("name");
  if (error) throw error;
  return data.map(packageFrom);
}

export async function loadEventSettings(supabase: Client, businessId: string): Promise<EventSettings> {
  const { data, error } = await supabase.from("event_settings").select("*").eq("business_id", businessId).single();
  if (error) throw error;
  return settingsFrom(data);
}

export async function loadTerms(supabase: Client, businessId: string): Promise<{ id: string; version: number; body: string }> {
  const { data, error } = await supabase.from("event_terms").select("id, version, body").eq("business_id", businessId).order("version", { ascending: false }).limit(1).single();
  if (error) throw error;
  return data;
}

export type TeamMember = { id: string; firstName: string; lastName: string; eventRoles: ("hair" | "makeup")[]; color: string | null };

// Everyone at the location who does event work, in the calendar's order.
export async function loadEventTeam(supabase: Client, locationId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from("staff")
    .select("id, first_name, last_name, event_roles, color, calendar_position")
    .eq("location_id", locationId)
    .eq("is_active", true)
    .filter("event_roles", "neq", "{}")
    .order("calendar_position", { nullsFirst: false })
    .order("first_name");
  if (error) throw error;
  return data.map((s) => ({ id: s.id, firstName: s.first_name, lastName: s.last_name, eventRoles: s.event_roles as ("hair" | "makeup")[], color: s.color }));
}

export async function loadTaxBp(supabase: Client, businessId: string): Promise<number> {
  const { data, error } = await supabase.from("businesses").select("tax_rate_services_bp").eq("id", businessId).single();
  if (error) throw error;
  return data.tax_rate_services_bp;
}

export type EventMemberRow = {
  id: string;
  position: number;
  name: string;
  partyRole: PartyRole;
  packageId: string | null;
  packageName: string;
  priceCents: number;
  hairMinutes: number;
  makeupMinutes: number;
  paysOwn: boolean;
  email: string | null;
  phone: string | null;
};

export type EventTaskRow = {
  id: string;
  memberId: string | null;
  kind: "hair" | "makeup" | "touch_up";
  role: "hair" | "makeup";
  lane: number;
  staffId: string | null;
  // Wall-clock minutes on the event's date.
  start: number;
  end: number;
};

export type EventDetail = {
  id: string;
  title: string;
  status: EventStatus;
  lostReason: string | null;
  date: string;
  readyBy: number | null;
  venueName: string | null;
  venueAddress: string | null;
  onLocation: boolean;
  travelMiles: number;
  travelMinutes: number;
  notes: string | null;
  source: "desk" | "denise" | "online";
  billing: "main" | "split";
  inquiryPartySize: number | null;
  inquiryServices: string | null;
  client: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null } | null;
  subtotalCents: number;
  travelFeeCents: number;
  earlyFeeCents: number;
  serviceChargeCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  createdAt: string;
  statusChangedAt: string;
  members: EventMemberRow[];
  tasks: EventTaskRow[];
};

export const EVENT_COLUMNS =
  "id, title, status, lost_reason, event_date, ready_by, venue_name, venue_address, on_location, travel_miles, travel_minutes, notes, source, billing, inquiry_party_size, inquiry_services, subtotal_cents, travel_fee_cents, early_fee_cents, service_charge_cents, tax_cents, total_cents, deposit_cents, created_at, status_changed_at, client:clients(id, first_name, last_name, phone, email), members:event_members(id, position, name, party_role, package_id, package_name, price_cents, hair_minutes, makeup_minutes, pays_own, email, phone), tasks:event_tasks(id, member_id, kind, role, lane, staff_id, starts_at, ends_at)";

type EventRow = {
  id: string;
  title: string;
  status: EventStatus;
  lost_reason: string | null;
  event_date: string;
  ready_by: string | null;
  venue_name: string | null;
  venue_address: string | null;
  on_location: boolean;
  travel_miles: number;
  travel_minutes: number;
  notes: string | null;
  source: string;
  billing: string;
  inquiry_party_size: number | null;
  inquiry_services: string | null;
  subtotal_cents: number;
  travel_fee_cents: number;
  early_fee_cents: number;
  service_charge_cents: number;
  tax_cents: number;
  total_cents: number;
  deposit_cents: number;
  created_at: string;
  status_changed_at: string;
  client: { id: string; first_name: string; last_name: string; phone: string | null; email: string | null } | null;
  members: { id: string; position: number; name: string; party_role: PartyRole; package_id: string | null; package_name: string; price_cents: number; hair_minutes: number; makeup_minutes: number; pays_own: boolean; email: string | null; phone: string | null }[];
  tasks: { id: string; member_id: string | null; kind: string; role: string; lane: number; staff_id: string | null; starts_at: string; ends_at: string }[];
};

export function eventFrom(e: EventRow, timeZone: string): EventDetail {
  const minute = (iso: string) => {
    const local = toLocal(new Date(iso), timeZone);
    // A time past midnight (a late event) keeps counting on.
    return local.date === e.event_date ? local.minute : local.date > e.event_date ? local.minute + 24 * 60 : local.minute - 24 * 60;
  };
  return {
    id: e.id,
    title: e.title,
    status: e.status,
    lostReason: e.lost_reason,
    date: e.event_date,
    readyBy: e.ready_by ? minute(e.ready_by) : null,
    venueName: e.venue_name,
    venueAddress: e.venue_address,
    onLocation: e.on_location,
    travelMiles: Number(e.travel_miles),
    travelMinutes: e.travel_minutes,
    notes: e.notes,
    source: e.source as EventDetail["source"],
    billing: e.billing as EventDetail["billing"],
    inquiryPartySize: e.inquiry_party_size,
    inquiryServices: e.inquiry_services,
    client: e.client ? { id: e.client.id, firstName: e.client.first_name, lastName: e.client.last_name, phone: e.client.phone, email: e.client.email } : null,
    subtotalCents: e.subtotal_cents,
    travelFeeCents: e.travel_fee_cents,
    earlyFeeCents: e.early_fee_cents,
    serviceChargeCents: e.service_charge_cents,
    taxCents: e.tax_cents,
    totalCents: e.total_cents,
    depositCents: e.deposit_cents,
    createdAt: e.created_at,
    statusChangedAt: e.status_changed_at,
    members: [...e.members]
      .sort((a, b) => a.position - b.position)
      .map((m) => ({ id: m.id, position: m.position, name: m.name, partyRole: m.party_role, packageId: m.package_id, packageName: m.package_name, priceCents: m.price_cents, hairMinutes: m.hair_minutes, makeupMinutes: m.makeup_minutes, paysOwn: m.pays_own, email: m.email, phone: m.phone })),
    tasks: e.tasks
      .map((t) => ({ id: t.id, memberId: t.member_id, kind: t.kind as EventTaskRow["kind"], role: t.role as EventTaskRow["role"], lane: t.lane, staffId: t.staff_id, start: minute(t.starts_at), end: minute(t.ends_at) }))
      .sort((a, b) => a.start - b.start || a.role.localeCompare(b.role) || a.lane - b.lane),
  };
}

export async function loadEvent(supabase: Client, id: string, timeZone: string): Promise<EventDetail | null> {
  const { data, error } = await supabase.from("events").select(EVENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? eventFrom(data as unknown as EventRow, timeZone) : null;
}

export type EventSummary = {
  id: string;
  title: string;
  status: EventStatus;
  date: string;
  readyBy: number | null;
  clientName: string | null;
  partySize: number;
  totalCents: number;
  onLocation: boolean;
  venueName: string | null;
  source: string;
  statusChangedAt: string;
};

// Every event at the salon from a date on (and recent closed ones).
export async function loadEventList(supabase: Client, businessId: string, timeZone: string, from: string): Promise<EventSummary[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id, title, status, event_date, ready_by, total_cents, on_location, venue_name, source, status_changed_at, inquiry_party_size, client:clients(first_name, last_name), members:event_members(count)")
    .eq("business_id", businessId)
    .gte("event_date", from)
    .order("event_date")
    .limit(500);
  if (error) throw error;
  return data.map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    date: e.event_date,
    readyBy: e.ready_by ? toLocal(new Date(e.ready_by), timeZone).minute : null,
    clientName: e.client ? `${e.client.first_name} ${e.client.last_name}`.trim() : null,
    partySize: (e.members as unknown as { count: number }[])[0]?.count || e.inquiry_party_size || 0,
    totalCents: e.total_cents,
    onLocation: e.on_location,
    venueName: e.venue_name,
    source: e.source,
    statusChangedAt: e.status_changed_at,
  }));
}
