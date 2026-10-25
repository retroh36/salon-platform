// Booking and changing recurring appointments. Every visit is checked
// against the booking rules through ./book.ts like any other, and a series
// is saved as one change: booking it, or changing "this and following" or
// "all" visits, saves every visit or none, reporting the ones that don't
// fit.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ACTION_STATUS, isEditable, type AppointmentAction, type AppointmentStatus } from "../appointments.ts";
import { changeStatus, moveItem, saveBookings, type BookingInput, type BookingItemInput, type SaveResult, type StatusResult } from "./book.ts";
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
    items.push({ id: ids[n], serviceId: l.serviceId, staffId: l.staffId, start, resource, ...(l.minutes ? { minutes: l.minutes } : {}) });
  }
  return items;
}

// "held_back": it fit, but wasn't saved because another visit didn't.
export type VisitResult = { date: LocalDate; ok: true; appointmentId: string } | { date: LocalDate; ok: false; error: string; problems?: BookingProblem[][] };

function failure(date: LocalDate, result: Exclude<SaveResult, { ok: true }>): VisitResult {
  return result.error === "invalid" ? { date, ok: false, error: "invalid", problems: result.problems } : { date, ok: false, error: result.error };
}

// Saves the visits as one change, all or nothing, and says how each went.
// A visit whose time doesn't exist that day (null) stops them all.
export async function saveVisits(
  supabase: Supabase,
  location: Location,
  visits: readonly { date: LocalDate; input: BookingInput | null }[],
  create?: Parameters<typeof saveBookings>[3],
): Promise<{ results: VisitResult[]; seriesId: string | null }> {
  if (visits.some((v) => !v.input)) {
    return { seriesId: null, results: visits.map((v) => (v.input ? { date: v.date, ok: false, error: "held_back" } : { date: v.date, ok: false, error: "invalid", problems: [[{ code: "invalid_start" }]] })) };
  }
  const saved = await saveBookings(supabase, location, visits.map((v) => v.input!), create);
  if (saved.ok) return { seriesId: saved.seriesId, results: visits.map((v, n) => ({ date: v.date, ok: true, appointmentId: saved.appointmentIds[n] })) };
  if (saved.error === "invalid") {
    return {
      seriesId: null,
      results: visits.map((v, n) => (saved.problems[n].some((p) => p.length) ? { date: v.date, ok: false, error: "invalid", problems: saved.problems[n] } : { date: v.date, ok: false, error: "held_back" })),
    };
  }
  return { seriesId: null, results: visits.map((v, n) => ({ date: v.date, ok: false, error: saved.visit === undefined || saved.visit === n ? saved.error : "held_back" })) };
}

// Which item on another visit a line of the edited one stands for: the one
// with the same service (in start order, each used once), not the one in
// the same position, so a reordered or added service never takes another
// service's place (or its booked length).
function matchItems(lines: readonly VisitLine[], edited: SeriesVisit, visit: SeriesVisit): (string | undefined)[] {
  if (visit.appointmentId === edited.appointmentId) return lines.map((l) => l.itemId);
  const used = new Set<string>();
  return lines.map((l) => {
    const service = l.itemId ? edited.items.find((i) => i.id === l.itemId)?.serviceId : undefined;
    const match = service ? visit.items.find((i) => i.serviceId === service && !used.has(i.id)) : undefined;
    if (match) used.add(match.id);
    return match?.id;
  });
}

// Books every visit of a new series (its own lines per date: staff may have
// picked an alternative for some), linked to the series in order, or none.
export async function bookSeries(
  supabase: Supabase,
  location: Location & { businessId: string },
  input: { clientId: string; notes: string | null; intervalWeeks: number; end: SeriesEnd; visits: { date: LocalDate; lines: VisitLine[] }[] },
): Promise<{ seriesId: string | null; results: VisitResult[] }> {
  const visits = [...input.visits].sort((a, b) => a.date.localeCompare(b.date));
  const { seriesId, results } = await saveVisits(
    supabase,
    location,
    visits.map((v) => {
      const items = itemsFor(v.lines, v.date, location.timezone);
      return { date: v.date, input: items && { clientId: input.clientId, notes: input.notes, items } };
    }),
    {
      series: {
        clientId: input.clientId,
        intervalWeeks: input.intervalWeeks,
        occurrences: input.end.kind === "count" ? input.end.count : null,
        endsOn: input.end.kind === "until" ? input.end.until : null,
      },
    },
  );
  return { seriesId, results };
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
  const all = await seriesVisits(supabase, series.seriesId, location.timezone);
  const edited = all.find((v) => v.appointmentId === appointmentId)!;
  const { results } = await saveVisits(
    supabase,
    location,
    visitsInScope(all, series.index, scope).map((v) => {
      const date = addDays(v.date, days);
      const items = itemsFor(input.lines, date, location.timezone, matchItems(input.lines, edited, v));
      return { date, input: items && { appointmentId: v.appointmentId, clientId: input.clientId, notes: input.notes, items } };
    }),
  );
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
  const moved = here.items.find((i) => i.id === move.itemId)!;
  const shift = toLocal(move.start, location.timezone).minute - moved.startMinute;
  const staffChanged = move.staffId !== item.staff_id;
  // The same service on each visit (the first of it, if there are two).
  const nth = here.items.filter((i) => i.serviceId === moved.serviceId).indexOf(moved);

  const visits: { date: LocalDate; input: BookingInput | null }[] = [];
  for (const v of visitsInScope(all, series.index, scope)) {
    const target = v.items.filter((i) => i.serviceId === moved.serviceId)[nth];
    if (!target) continue;
    const start = fromLocal(v.date, target.startMinute + shift, location.timezone);
    visits.push({
      date: v.date,
      input: start && {
        appointmentId: v.appointmentId,
        clientId: v.clientId,
        notes: v.notes,
        // Only that service moves; the rest stay, with their chairs.
        items: v.items.map((i) =>
          i.id === target.id
            ? { id: i.id, serviceId: i.serviceId, staffId: staffChanged ? move.staffId : i.staffId, start, resource: { kind: "any" as const, prefer: i.resourceId } }
            : { id: i.id, serviceId: i.serviceId, staffId: i.staffId, start: i.start, resource: i.resourceId ? { kind: "exact" as const, id: i.resourceId } : { kind: "none" as const } },
        ),
      },
    });
  }
  return (await saveVisits(supabase, location, visits)).results;
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
