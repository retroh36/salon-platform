// Moving a visit to another day (and/or time): every service on it moves
// together, keeping its stylist and the gaps between services, each one
// checked against the booking rules through ./book.ts like any change. A
// repeating visit moves this one, this and following, or all, each by the
// same number of days (visit by visit; ones that don't fit are reported).
// A group visit moves the whole party (./group-book.ts), or no one.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { saveBooking, type BookingItemInput, type SaveResult } from "./book.ts";
import { moveGroupItem, type GroupMoveResult } from "./group-book.ts";
import { seriesVisits, type VisitResult } from "./series-book.ts";
import { visitsInScope, type Scope } from "./series.ts";
import { addDays, daysBetween, shiftStart, toLocal, type LocalDate } from "./time.ts";

type Supabase = SupabaseClient<Database>;
type Location = { id: string; timezone: string };

export type MoveVisitResult =
  | { kind: "single"; date: LocalDate; result: SaveResult }
  | { kind: "series"; results: VisitResult[] }
  | { kind: "group"; result: GroupMoveResult }
  | { kind: "error"; error: "not_found" | "not_movable" | "invalid_time" };

type Item = { id: string; service_id: string; staff_id: string; resource_id: string | null; starts_at: string };

function shiftedItems(items: readonly Item[], timeZone: string, days: number, minutes: number): BookingItemInput[] | null {
  const out: BookingItemInput[] = [];
  for (const i of items) {
    const start = shiftStart(new Date(i.starts_at), timeZone, days, minutes);
    if (!start) return null;
    // Their chair if it's free there, else any free one.
    out.push({ id: i.id, serviceId: i.service_id, staffId: i.staff_id, start, resource: i.resource_id ? { kind: "any", prefer: i.resource_id } : { kind: "none" } });
  }
  return out;
}

export async function moveVisitTo(
  supabase: Supabase,
  location: Location,
  move: { appointmentId: string; date: LocalDate; startMinute: number },
  scope: Scope = "this",
): Promise<MoveVisitResult> {
  const { data: a, error } = await supabase
    .from("appointments")
    .select("id, status, client_id, notes, group_id, series_id, series_index, appointment_items(id, service_id, staff_id, resource_id, starts_at)")
    .eq("id", move.appointmentId)
    .maybeSingle();
  if (error) throw error;
  if (!a || !a.appointment_items.length) return { kind: "error", error: "not_found" };
  // Only visits still to come move (not once the client's here).
  if (a.status !== "booked" && a.status !== "confirmed") return { kind: "error", error: "not_movable" };
  const items = [...a.appointment_items].sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  const first = toLocal(new Date(items[0].starts_at), location.timezone);
  const days = daysBetween(first.date, move.date);
  const minutes = move.startMinute - first.minute;

  if (a.group_id) {
    const start = shiftStart(new Date(items[0].starts_at), location.timezone, days, minutes);
    if (!start) return { kind: "error", error: "invalid_time" };
    return { kind: "group", result: await moveGroupItem(supabase, location, { itemId: items[0].id, staffId: items[0].staff_id, start }) };
  }

  if (a.series_id && scope !== "this") {
    const results: VisitResult[] = [];
    for (const v of visitsInScope(await seriesVisits(supabase, a.series_id, location.timezone), a.series_index!, scope)) {
      const date = addDays(v.date, days);
      const visitItems = shiftedItems(
        v.items.map((i) => ({ id: i.id, service_id: i.serviceId, staff_id: i.staffId, resource_id: i.resourceId, starts_at: i.start.toISOString() })),
        location.timezone,
        days,
        minutes,
      );
      if (!visitItems) {
        results.push({ date, ok: false, error: "invalid" });
        continue;
      }
      const saved = await saveBooking(supabase, location, { appointmentId: v.appointmentId, clientId: v.clientId, notes: v.notes, items: visitItems });
      results.push(saved.ok ? { date, ok: true, appointmentId: v.appointmentId } : saved.error === "invalid" ? { date, ok: false, error: "invalid", problems: saved.problems } : { date, ok: false, error: saved.error });
    }
    return { kind: "series", results };
  }

  const shifted = shiftedItems(items, location.timezone, days, minutes);
  if (!shifted) return { kind: "error", error: "invalid_time" };
  return { kind: "single", date: move.date, result: await saveBooking(supabase, location, { appointmentId: a.id, clientId: a.client_id, notes: a.notes, items: shifted }) };
}
