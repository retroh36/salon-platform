// Booking and changing recurring appointments. Each visit goes through
// ./book.ts like any other (so the booking rules apply to each one), and is
// linked to its series. Changes to "this and following" or "all" visits
// are made visit by visit; ones that don't fit are reported, not forced.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ACTION_STATUS, isEditable, type AppointmentAction, type AppointmentStatus } from "../appointments.ts";
import { changeStatus, moveItem, saveBooking, type BookingItemInput, type SaveResult, type StatusResult } from "./book.ts";
import type { BookingProblem } from "./booking.ts";
import { visitsInScope, type Scope, type SeriesEnd, type VisitLine } from "./series.ts";
import { addDays, fromLocal, toLocal, type LocalDate } from "./time.ts";

type Supabase = SupabaseClient<Database>;
type Location = { id: string; timezone: string };

export function itemsFor(lines: readonly VisitLine[], date: LocalDate, timeZone: string, ids: (string | undefined)[] = []): BookingItemInput[] | null {
  const items: BookingItemInput[] = [];
  for (const [n, l] of lines.entries()) {
    const start = fromLocal(date, l.startMinute, timeZone);
    if (!start) return null;
    const resource = l.resource === "any" ? ({ kind: "any" } as const) : l.resource === "none" ? ({ kind: "none" } as const) : ({ kind: "exact", id: l.resource } as const);
    items.push({ id: ids[n], serviceId: l.serviceId, staffId: l.staffId, start, resource });
  }
  return items;
}

export type VisitResult = { date: LocalDate; ok: true; appointmentId: string } | { date: LocalDate; ok: false; error: string; problems?: BookingProblem[][] };

function failure(date: LocalDate, result: Exclude<SaveResult, { ok: true }>): VisitResult {
  return result.error === "invalid" ? { date, ok: false, error: "invalid", problems: result.problems } : { date, ok: false, error: result.error };
}

// Books each visit of a new series (its own lines per date: staff may have
// picked an alternative for some), linked to the series in order.
export async function bookSeries(
  supabase: Supabase,
  location: Location & { businessId: string },
  input: { clientId: string; notes: string | null; intervalWeeks: number; end: SeriesEnd; visits: { date: LocalDate; lines: VisitLine[] }[] },
): Promise<{ seriesId: string | null; results: VisitResult[] }> {
  const { data: series, error } = await supabase
    .from("appointment_series")
    .insert({
      business_id: location.businessId,
      location_id: location.id,
      client_id: input.clientId,
      interval_weeks: input.intervalWeeks,
      occurrences: input.end.kind === "count" ? input.end.count : null,
      ends_on: input.end.kind === "until" ? input.end.until : null,
    })
    .select("id")
    .single();
  if (error?.code === "42501") return { seriesId: null, results: input.visits.map((v) => ({ date: v.date, ok: false, error: "forbidden" })) };
  if (error) throw error;

  const results: VisitResult[] = [];
  let index = 0;
  for (const visit of [...input.visits].sort((a, b) => a.date.localeCompare(b.date))) {
    const items = itemsFor(visit.lines, visit.date, location.timezone);
    if (!items) {
      results.push({ date: visit.date, ok: false, error: "invalid", problems: visit.lines.map(() => [{ code: "invalid_start" }]) });
      continue;
    }
    const saved = await saveBooking(supabase, location, { clientId: input.clientId, notes: input.notes, items });
    if (!saved.ok) {
      results.push(failure(visit.date, saved));
      continue;
    }
    index++;
    const { error: linkError } = await supabase.rpc("set_appointment_series", { p_appointment_id: saved.appointmentId, p_series_id: series.id, p_index: index });
    if (linkError) throw linkError;
    results.push({ date: visit.date, ok: true, appointmentId: saved.appointmentId });
  }
  return { seriesId: series.id, results };
}

export type SeriesVisit = {
  appointmentId: string;
  index: number;
  date: LocalDate;
  status: AppointmentStatus;
  editable: boolean;
  clientId: string | null;
  notes: string | null;
  // In start order.
  items: { id: string; serviceId: string; staffId: string; resourceId: string | null; start: Date; startMinute: number }[];
};

export async function seriesVisits(supabase: Supabase, seriesId: string, timeZone: string): Promise<SeriesVisit[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, series_index, status, client_id, notes, starts_at, appointment_items(id, service_id, staff_id, resource_id, starts_at)")
    .eq("series_id", seriesId)
    .order("series_index");
  if (error) throw error;
  return data.map((a) => ({
    appointmentId: a.id,
    index: a.series_index!,
    date: toLocal(new Date(a.starts_at), timeZone).date,
    status: a.status,
    editable: isEditable(a.status) && a.status !== "checked_in",
    clientId: a.client_id,
    notes: a.notes,
    items: a.appointment_items
      .map((i) => ({ id: i.id, serviceId: i.service_id, staffId: i.staff_id, resourceId: i.resource_id, start: new Date(i.starts_at), startMinute: toLocal(new Date(i.starts_at), timeZone).minute }))
      .sort((x, y) => x.start.getTime() - y.start.getTime()),
  }));
}

async function seriesOf(supabase: Supabase, appointmentId: string): Promise<{ seriesId: string; index: number } | null> {
  const { data, error } = await supabase.from("appointments").select("series_id, series_index").eq("id", appointmentId).maybeSingle();
  if (error) throw error;
  return data?.series_id ? { seriesId: data.series_id, index: data.series_index! } : null;
}

// Changes a visit's services, stylists and times, and the same on the
// other visits in scope (same times of day, on their own dates).
export async function changeSeries(
  supabase: Supabase,
  location: Location,
  appointmentId: string,
  scope: Scope,
  input: { clientId: string; notes: string | null; lines: VisitLine[] },
  // Moves each visit this many days too (a new date on the edited one).
  days = 0,
): Promise<VisitResult[]> {
  const series = await seriesOf(supabase, appointmentId);
  if (!series) return [{ date: "", ok: false, error: "not_found" }];
  const visits = visitsInScope(await seriesVisits(supabase, series.seriesId, location.timezone), series.index, scope);
  const results: VisitResult[] = [];
  for (const v of visits) {
    const date = addDays(v.date, days);
    const items = itemsFor(input.lines, date, location.timezone, input.lines.map((_, n) => v.items[n]?.id));
    if (!items) {
      results.push({ date, ok: false, error: "invalid" });
      continue;
    }
    const saved = await saveBooking(supabase, location, { appointmentId: v.appointmentId, clientId: input.clientId, notes: input.notes, items });
    results.push(saved.ok ? { date, ok: true, appointmentId: v.appointmentId } : failure(date, saved));
  }
  return results;
}

// Moves a service on a visit to a new time and/or stylist, and the same
// service on the other visits in scope by the same amount.
export async function moveSeriesItem(
  supabase: Supabase,
  location: Location,
  move: { itemId: string; staffId: string; start: Date },
  scope: Scope,
): Promise<VisitResult[]> {
  const { data: item, error } = await supabase.from("appointment_items").select("appointment_id, staff_id, starts_at").eq("id", move.itemId).maybeSingle();
  if (error) throw error;
  if (!item) return [{ date: "", ok: false, error: "not_found" }];
  const series = await seriesOf(supabase, item.appointment_id);
  if (!series || scope === "this") {
    const r = await moveItem(supabase, location, move);
    return [r.ok ? { date: toLocal(move.start, location.timezone).date, ok: true, appointmentId: item.appointment_id } : failure(toLocal(move.start, location.timezone).date, r)];
  }
  const all = await seriesVisits(supabase, series.seriesId, location.timezone);
  const here = all.find((v) => v.appointmentId === item.appointment_id)!;
  const position = here.items.findIndex((i) => i.id === move.itemId);
  const shift = toLocal(move.start, location.timezone).minute - here.items[position].startMinute;
  const staffChanged = move.staffId !== item.staff_id;

  const results: VisitResult[] = [];
  for (const v of visitsInScope(all, series.index, scope)) {
    const target = v.items[position];
    if (!target) continue;
    const start = fromLocal(v.date, target.startMinute + shift, location.timezone);
    if (!start) {
      results.push({ date: v.date, ok: false, error: "invalid" });
      continue;
    }
    const r = await moveItem(supabase, location, { itemId: target.id, staffId: staffChanged ? move.staffId : target.staffId, start });
    results.push(r.ok ? { date: v.date, ok: true, appointmentId: v.appointmentId } : failure(v.date, r));
  }
  return results;
}

// Cancels (or marks no-show, etc.) the visits in scope that still can be.
export async function changeSeriesStatus(
  supabase: Supabase,
  appointmentId: string,
  scope: Scope,
  action: AppointmentAction,
  reason: string | null,
  timeZone: string,
): Promise<{ date: LocalDate; result: StatusResult }[]> {
  const series = await seriesOf(supabase, appointmentId);
  if (!series || scope === "this") return [{ date: "", result: await changeStatus(supabase, appointmentId, action, reason) }];
  const visits = visitsInScope(await seriesVisits(supabase, series.seriesId, timeZone), series.index, scope).filter((v) => v.status !== ACTION_STATUS[action]);
  const out: { date: LocalDate; result: StatusResult }[] = [];
  for (const v of visits) out.push({ date: v.date, result: await changeStatus(supabase, v.appointmentId, action, reason) });
  return out;
}
