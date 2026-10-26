// Loading a sick-day rescue (server): who's out and from when (their
// call-out), every visit it touches, the team, the calendar for the next
// two weeks and each stylist's usual lengths, planned by
// lib/scheduling/rescue.ts and put in rows by lib/rescue.ts. Read as the
// signed-in staff member (RLS decides).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadDurations, usualTimings } from "@/lib/insights/read";
import { rescueRows, type RescueFacts, type RescueRow } from "@/lib/rescue";
import { levelPricesFrom, stylistPrice } from "@/lib/services";
import { loadBookingContext } from "@/lib/scheduling/load";
import { proposalFromJson } from "@/lib/scheduling/ai-actions";
import { planRescue, RESCHEDULE_DAYS, type Level, type RescueVisit } from "@/lib/scheduling/rescue";
import { addDays, formatMinute, fromLocal, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";

type Supabase = SupabaseClient<Database>;
type Location = { id: string; timezone: string };

export type RescueOut = { disruptionId: string; from: string; allDay: boolean; text: string };

export type RescuePlan = {
  staff: { id: string; firstName: string; name: string };
  date: LocalDate;
  // Null until they're marked out.
  out: RescueOut | null;
  rows: RescueRow[];
  // A rescue applied for this stylist and day, with Undo, and what it did
  // to each visit (for the messages).
  applied: { actionId: string; at: string; by: string | null; lines: { appointmentId: string; kind: "cover" | "shift" | "reschedule" | "leave" }[] } | null;
};

// Each attempt has its own subject (a refused apply is rejected, and a
// rejected subject is never proposed again): rescue:<staff>:<date>:<attempt>.
export const rescueSubject = (staffId: string, date: LocalDate) => `rescue:${staffId}:${date}:`;

// The stylist's call-out on that day, if they've been marked out.
export async function loadCallOut(supabase: Supabase, location: Location, staffId: string, date: LocalDate): Promise<RescueOut | null> {
  const { data } = await supabase
    .from("schedule_disruptions")
    .select("id, starts_at")
    .eq("location_id", location.id)
    .eq("kind", "call_out")
    .eq("staff_id", staffId)
    .eq("on_date", date)
    .maybeSingle();
  if (!data?.starts_at) return null;
  const from = new Date(data.starts_at);
  const minute = toLocal(from, location.timezone).minute;
  // Out before the salon opens counts as the whole day.
  const allDay = toLocal(from, location.timezone).date < date || minute <= 6 * 60;
  return { disruptionId: data.id, from: data.starts_at, allDay, text: allDay ? "all day" : `from ${formatMinute(minute)}` };
}

export async function loadRescue(supabase: Supabase, location: Location, businessId: string, staffId: string, date: LocalDate, now = new Date()): Promise<RescuePlan | null> {
  const tz = location.timezone;
  const { data: person } = await supabase.from("staff").select("id, first_name, last_name, level, location_id").eq("id", staffId).maybeSingle();
  if (!person || person.location_id !== location.id) return null;
  const staff = { id: person.id, firstName: person.first_name, name: fullName(person) };
  const [out, applied] = await Promise.all([loadCallOut(supabase, location, staffId, date), loadApplied(supabase, location, staffId, date)]);
  if (!out) return { staff, date, out: null, rows: [], applied };
  if (applied) {
    // Visits it left with them: the client needs a call to move.
    const left = await stillWith(supabase, location, staffId, date, new Date(out.from));
    for (const id of left) if (!applied.lines.some((l) => l.appointmentId === id)) applied.lines.push({ appointmentId: id, kind: "leave" });
    return { staff, date, out, rows: [], applied };
  }

  const dayStart = fromLocal(date, 0, tz)!;
  const dayEnd = fromLocal(addDays(date, 1), 0, tz)!;
  const { data: mine, error } = await supabase
    .from("appointment_items")
    .select("appointment_id")
    .eq("location_id", location.id)
    .eq("staff_id", staffId)
    .gte("starts_at", dayStart.toISOString())
    .lt("starts_at", dayEnd.toISOString());
  if (error) throw error;
  const ids = [...new Set((mine ?? []).map((i) => i.appointment_id))];

  const [visitRows, team, services, offers, ctx, learned] = await Promise.all([
    ids.length
      ? supabase
          .from("appointments")
          .select(
            "id, status, client_id, client:clients(first_name, last_name, preferred_staff_id, only_sees_preferred), items:appointment_items(id, service_id, staff_id, resource_id, starts_at, active_minutes, processing_minutes, finishing_minutes)",
          )
          .in("id", ids)
          .in("status", ["booked", "confirmed", "checked_in"])
      : Promise.resolve({ data: [], error: null }),
    supabase.from("staff").select("id, first_name, last_name, level").eq("location_id", location.id).eq("is_active", true),
    supabase.from("services").select("id, name, price_cents, service_level_prices(level, price_cents)").eq("business_id", businessId),
    supabase.from("staff_services").select("staff_id, service_id, price_cents").eq("business_id", businessId),
    loadBookingContext(supabase, location, date, addDays(date, RESCHEDULE_DAYS)),
    loadDurations(supabase, businessId),
  ]);
  if (visitRows.error) throw visitRows.error;

  const visits: RescueVisit[] = (visitRows.data ?? []).map((a) => ({
    appointmentId: a.id,
    clientId: a.client_id,
    movable: a.status === "booked" || a.status === "confirmed",
    items: [...(a.items ?? [])]
      .sort((x, y) => x.starts_at.localeCompare(y.starts_at))
      .map((i) => ({
        id: i.id,
        appointmentId: a.id,
        serviceId: i.service_id,
        staffId: i.staff_id,
        resourceId: i.resource_id,
        start: new Date(i.starts_at),
        activeMinutes: i.active_minutes,
        processingMinutes: i.processing_minutes,
        finishingMinutes: i.finishing_minutes,
      })),
    preferredStaffId: a.client?.preferred_staff_id ?? null,
    onlySees: Boolean(a.client?.only_sees_preferred && a.client.preferred_staff_id === staffId),
  }));

  const stylists = (team.data ?? []).filter((s) => ctx.staff.has(s.id)).map((s) => ({ id: s.id, firstName: s.first_name, level: (s.level ?? null) as Level }));
  const { timingOf } = usualTimings(ctx, learned);
  const lines = planRescue(ctx, { staffId, date, from: new Date(out.from), visits, stylists, timingOf, now });

  const serviceRows = new Map((services.data ?? []).map((s) => [s.id, s]));
  const levelOf = new Map((team.data ?? []).map((s) => [s.id, s.level ?? null]));
  const own = new Map((offers.data ?? []).map((o) => [`${o.staff_id}:${o.service_id}`, o]));
  const facts: RescueFacts = {
    tz,
    date,
    absentName: person.first_name,
    names: new Map((team.data ?? []).map((s) => [s.id, s.first_name])),
    levels: levelOf,
    services: new Map((services.data ?? []).map((s) => [s.id, s.name])),
    priceOf: (sId, serviceId) => {
      const service = serviceRows.get(serviceId);
      const offer = own.get(`${sId}:${serviceId}`);
      if (!service || !offer) return null;
      return stylistPrice({ price_cents: service.price_cents, levelPrices: levelPricesFrom(service.service_level_prices ?? []) }, { level: levelOf.get(sId) ?? null, customCents: offer.price_cents });
    },
  };
  const clients = new Map(
    (visitRows.data ?? []).flatMap((a) => (a.client && a.client_id ? [[a.client_id, { name: fullName(a.client), firstName: a.client.first_name }] as const] : [])),
  );
  return { staff, date, out, rows: rescueRows(lines, facts, staffId, clients), applied };
}

// The rescue applied for this stylist and day, while it can be undone.
async function loadApplied(supabase: Supabase, location: Location, staffId: string, date: LocalDate): Promise<RescuePlan["applied"]> {
  const { data } = await supabase
    .from("ai_actions")
    .select("id, decided_at, proposal, decider:staff!ai_actions_decided_by_business_id_fkey(first_name)")
    .eq("location_id", location.id)
    .like("subject", `${rescueSubject(staffId, date)}%`)
    .eq("status", "approved")
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const tz = location.timezone;
  const lines = new Map<string, "cover" | "shift" | "reschedule">();
  for (const c of proposalFromJson(data.proposal).changes) {
    const kind = toLocal(c.to.start, tz).date !== date ? "reschedule" : c.to.start.getTime() !== c.from.start.getTime() ? "shift" : "cover";
    const had = lines.get(c.appointmentId);
    if (!had || (had === "cover" && kind !== "cover")) lines.set(c.appointmentId, kind);
  }
  return { actionId: data.id, at: data.decided_at!, by: data.decider?.first_name ?? null, lines: [...lines].map(([appointmentId, kind]) => ({ appointmentId, kind })) };
}

// Upcoming visits still with the stylist after they're out.
async function stillWith(supabase: Supabase, location: Location, staffId: string, date: LocalDate, from: Date): Promise<string[]> {
  const end = fromLocal(addDays(date, 1), 0, location.timezone)!;
  const { data } = await supabase
    .from("appointment_items")
    .select("appointment_id, ends_at, appointment:appointments!inner(status)")
    .eq("location_id", location.id)
    .eq("staff_id", staffId)
    .gt("ends_at", from.toISOString())
    .lt("starts_at", end.toISOString())
    .in("appointment.status", ["booked", "confirmed"]);
  return [...new Set((data ?? []).map((d) => d.appointment_id))];
}
