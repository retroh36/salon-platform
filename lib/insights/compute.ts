// Loads a salon's history, runs the learning engine and stores what it
// learned in `insights`. Run nightly for every salon (scripts/insights.ts,
// /api/cron/insights) and after each checkout for that visit's client and
// stylists (recomputeForVisit). Needs the service role: insights are never
// written by staff. Runs under plain Node.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types.ts";
import { toLocal } from "../scheduling/time.ts";
import { clientInsight, type ClientVisit, type VisitStatus } from "./clients.ts";
import { stylistDurations, type DurationSample } from "./durations.ts";
import { salonInsight, type OpenHours, type SalonItem } from "./salon.ts";

type Admin = SupabaseClient<Database>;

// How far back the engine looks.
export const HISTORY_DAYS = 365;
const DAY = 86_400_000;
const PAGE = 1000;

type ItemRow = {
  id: string;
  appointment_id: string;
  location_id: string;
  staff_id: string;
  service_id: string;
  starts_at: string;
  active_minutes: number;
  processing_minutes: number;
  finishing_minutes: number;
  price_cents: number;
  started_at: string | null;
  finished_at: string | null;
  appointment: { client_id: string | null; status: string; created_at: string; checked_in_at: string | null; checked_out_at: string | null; starts_at: string };
};

type History = {
  items: ItemRow[];
  retailByAppointment: Map<string, number>;
  timezones: Map<string, string>;
  open: Map<string, OpenHours>;
  menu: Map<string, number>;
};

async function loadHistory(admin: Admin, businessId: string, filter: { clientIds?: string[]; staffIds?: string[] } = {}): Promise<History> {
  const since = new Date(Date.now() - HISTORY_DAYS * DAY).toISOString();
  const items: ItemRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = admin
      .from("appointment_items")
      .select(
        "id, appointment_id, location_id, staff_id, service_id, starts_at, active_minutes, processing_minutes, finishing_minutes, price_cents, started_at, finished_at, appointment:appointments!inner(client_id, status, created_at, checked_in_at, checked_out_at, starts_at)",
      )
      .eq("business_id", businessId)
      .gte("starts_at", since);
    if (filter.clientIds) q = q.in("appointment.client_id", filter.clientIds);
    if (filter.staffIds) q = q.in("staff_id", filter.staffIds);
    const { data, error } = await q.order("starts_at").order("id").range(offset, offset + PAGE - 1);
    if (error) throw error;
    items.push(...(data as ItemRow[]));
    if (data.length < PAGE) break;
  }

  const appointmentIds = new Set(items.map((i) => i.appointment_id));
  const retailByAppointment = new Map<string, number>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("stock_movements")
      .select("appointment_id, change, product:products(price_cents)")
      .eq("business_id", businessId)
      .eq("reason", "sale")
      .not("appointment_id", "is", null)
      .gte("created_at", since)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const m of data) {
      if (!m.appointment_id || !appointmentIds.has(m.appointment_id)) continue;
      const cents = Math.round(-Number(m.change) * (m.product?.price_cents ?? 0));
      retailByAppointment.set(m.appointment_id, (retailByAppointment.get(m.appointment_id) ?? 0) + cents);
    }
    if (data.length < PAGE) break;
  }

  const [locations, hours, services] = await Promise.all([
    admin.from("locations").select("id, timezone").eq("business_id", businessId),
    admin.from("location_hours").select("location_id, weekday, start_minute, end_minute").eq("business_id", businessId),
    admin.from("services").select("id, duration_minutes").eq("business_id", businessId),
  ]);
  if (locations.error) throw locations.error;
  if (hours.error) throw hours.error;
  if (services.error) throw services.error;
  const open = new Map<string, OpenHours>();
  for (const h of hours.data) {
    const o = open.get(h.location_id) ?? {};
    (o[h.weekday] ??= []).push({ start: h.start_minute, end: h.end_minute });
    open.set(h.location_id, o);
  }
  return {
    items,
    retailByAppointment,
    timezones: new Map(locations.data.map((l) => [l.id, l.timezone])),
    open,
    menu: new Map(services.data.map((s) => [s.id, s.duration_minutes ?? 0])),
  };
}

const booked = (i: ItemRow) => i.active_minutes + i.processing_minutes + i.finishing_minutes;
const actual = (i: ItemRow) => (i.started_at && i.finished_at ? Math.round((new Date(i.finished_at).getTime() - new Date(i.started_at).getTime()) / 60_000) : null);

function durationSamples(h: History): DurationSample[] {
  return h.items
    .filter((i) => i.appointment.status === "completed" || i.appointment.status === "checked_in")
    .flatMap((i) => {
      const minutes = actual(i);
      return minutes ? [{ staffId: i.staff_id, serviceId: i.service_id, bookedMinutes: booked(i), actualMinutes: minutes, at: new Date(i.starts_at) }] : [];
    });
}

// Each client's visits, one per appointment.
function clientVisits(h: History): Map<string, ClientVisit[]> {
  const byAppointment = new Map<string, ItemRow[]>();
  for (const i of h.items) byAppointment.set(i.appointment_id, [...(byAppointment.get(i.appointment_id) ?? []), i]);
  const byClient = new Map<string, ClientVisit[]>();
  for (const [appointmentId, list] of byAppointment) {
    const a = list[0].appointment;
    if (!a.client_id) continue;
    const ordered = [...list].sort((x, y) => x.starts_at.localeCompare(y.starts_at));
    const start = new Date(a.starts_at);
    const local = toLocal(start, h.timezones.get(ordered[0].location_id) ?? "UTC");
    byClient.set(a.client_id, [
      ...(byClient.get(a.client_id) ?? []),
      {
        appointmentId,
        start,
        weekday: isoWeekday(local.date),
        minute: local.minute,
        status: a.status as VisitStatus,
        staffIds: [...new Set(ordered.map((i) => i.staff_id))],
        serviceIds: ordered.map((i) => i.service_id),
        minutesLate: a.checked_in_at ? Math.round((new Date(a.checked_in_at).getTime() - start.getTime()) / 60_000) : null,
        serviceCents: ordered.reduce((sum, i) => sum + i.price_cents, 0),
        retailCents: h.retailByAppointment.get(appointmentId) ?? 0,
      },
    ]);
  }
  return byClient;
}

function salonItems(h: History, locationId: string): SalonItem[] {
  const tz = h.timezones.get(locationId) ?? "UTC";
  return h.items
    .filter((i) => i.location_id === locationId && new Date(i.starts_at).getTime() <= Date.now())
    .map((i) => {
      const local = toLocal(new Date(i.starts_at), tz);
      return {
        appointmentId: i.appointment_id,
        clientId: i.appointment.client_id,
        staffId: i.staff_id,
        serviceId: i.service_id,
        start: new Date(i.starts_at),
        weekday: isoWeekday(local.date),
        minute: local.minute,
        bookedMinutes: booked(i),
        actualMinutes: actual(i),
        status: i.appointment.status as VisitStatus,
        createdAt: new Date(i.appointment.created_at),
        checkedOutAt: i.appointment.checked_out_at ? new Date(i.appointment.checked_out_at) : null,
      };
    });
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

type Row = { business_id: string; kind: string; key: string; data: NonNullable<Json>; computed_at: string };

async function store(admin: Admin, rows: Row[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("insights").upsert(rows.slice(i, i + 500));
    if (error) throw error;
  }
}

function clientRows(businessId: string, byClient: Map<string, ClientVisit[]>, asOf: Date, at: string): Row[] {
  return [...byClient].flatMap(([clientId, visits]) => {
    const { lifetimeSpendCents, averageVisitCents, retailRate, ...habits } = clientInsight(visits, asOf);
    return [
      { business_id: businessId, kind: "client", key: clientId, data: habits as unknown as NonNullable<Json>, computed_at: at },
      { business_id: businessId, kind: "client_spend", key: clientId, data: { lifetimeSpendCents, averageVisitCents, retailRate }, computed_at: at },
    ];
  });
}

function durationRows(businessId: string, h: History, at: string, asOf: Date): Row[] {
  return stylistDurations(durationSamples(h), h.menu, asOf).map((d) => ({ business_id: businessId, kind: "duration", key: `${d.staffId}:${d.serviceId}`, data: d as unknown as NonNullable<Json>, computed_at: at }));
}

// Everything, for one salon. Rows nothing produced any more are removed.
export async function computeInsights(admin: Admin, businessId: string, asOf = new Date()): Promise<{ durations: number; clients: number; locations: number }> {
  const at = new Date().toISOString();
  const h = await loadHistory(admin, businessId);
  const durations = durationRows(businessId, h, at, asOf);
  const clients = clientRows(businessId, clientVisits(h), asOf, at);
  const weeks = Math.max(1, Math.round((asOf.getTime() - Math.min(...h.items.map((i) => new Date(i.starts_at).getTime()), asOf.getTime())) / (7 * DAY)));
  const salons = [...h.timezones.keys()].map((locationId) => ({
    business_id: businessId,
    kind: "salon",
    key: locationId,
    data: salonInsight(salonItems(h, locationId), h.open.get(locationId) ?? {}, weeks) as unknown as NonNullable<Json>,
    computed_at: at,
  }));
  await store(admin, [...durations, ...clients, ...salons]);
  const { error } = await admin.from("insights").delete().eq("business_id", businessId).lt("computed_at", at);
  if (error) throw error;
  return { durations: durations.length, clients: clients.length / 2, locations: salons.length };
}

// After a checkout: the visit's client, and its stylists' durations.
export async function recomputeForVisit(admin: Admin, appointmentId: string, asOf = new Date()): Promise<void> {
  const { data: visit, error } = await admin
    .from("appointments")
    .select("business_id, client_id, appointment_items(staff_id)")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw error;
  if (!visit) return;
  const at = new Date().toISOString();
  const staffIds = [...new Set(visit.appointment_items.map((i) => i.staff_id))];
  const [forClient, forStaff] = await Promise.all([
    visit.client_id ? loadHistory(admin, visit.business_id, { clientIds: [visit.client_id] }) : null,
    staffIds.length ? loadHistory(admin, visit.business_id, { staffIds }) : null,
  ]);
  await store(admin, [
    ...(forClient ? clientRows(visit.business_id, clientVisits(forClient), asOf, at) : []),
    ...(forStaff ? durationRows(visit.business_id, forStaff, at, asOf) : []),
  ]);
}
