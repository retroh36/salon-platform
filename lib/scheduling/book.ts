// Booking, changing and moving appointments.
//
// Every write to the calendar goes through here: it loads the calendar,
// checks the changed items against the booking rules (./booking.ts) and
// saves through the database's save_appointment, passing the calendar
// version it checked against. If someone else saved in the meantime, the
// database refuses and this re-checks against the new calendar.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { allowedActions, ACTION_STATUS, isEditable, type AppointmentAction, type AppointmentStatus } from "../appointments.ts";
import { checkItem, durationMinutes, pickResource, stretchTiming, timingFor, type BookedItem, type BookingProblem, type ServiceTiming } from "./booking.ts";
import { loadBookingContext } from "./load.ts";
import { patchTestState, type PatchSettings } from "./patch-tests.ts";
import { toLocal } from "./time.ts";

type Supabase = SupabaseClient<Database>;
type Location = { id: string; timezone: string };

export type ResourceChoice =
  | { kind: "none" }
  | { kind: "exact"; id: string }
  // A free chair, `prefer` if it's free.
  | { kind: "any"; prefer?: string | null };

export type BookingItemInput = {
  id?: string;
  serviceId: string;
  staffId: string;
  resource: ResourceChoice;
  start: Date;
  // This booking's own length (e.g. the stylist's usual time), as a
  // timing or in minutes (stretched from the stylist's timing); otherwise a
  // new service takes the stylist's length and a kept one keeps its own.
  timing?: ServiceTiming;
  minutes?: number;
};

export type BookingInput = {
  // Set to change an existing visit; its items become exactly `items`.
  appointmentId?: string;
  clientId: string | null;
  notes: string | null;
  items: BookingItemInput[];
  // An edit: the visit as the person editing it saw it when they opened
  // it. If it's been changed since (someone else moved it, changed a
  // service or the notes), the save is refused ("changed") rather than
  // undoing their change.
  seen?: VisitSeen;
};

export type VisitSeen = { notes: string | null; items: { id: string; serviceId: string; staffId: string; start: Date }[] };

export type SaveError = "no_items" | "not_found" | "not_editable" | "forbidden" | "busy" | "changed";

// Whether the visit is still as the editor saw it.
function stillAsSeen(seen: VisitSeen, existing: { notes: string | null; items: ExistingItem[] }): boolean {
  if ((seen.notes ?? "") !== (existing.notes ?? "") || seen.items.length !== existing.items.length) return false;
  const now = new Map(existing.items.map((i) => [i.id, i]));
  return seen.items.every((i) => {
    const e = now.get(i.id);
    return e && e.serviceId === i.serviceId && e.staffId === i.staffId && e.start.getTime() === i.start.getTime();
  });
}

export type SaveResult =
  | { ok: true; appointmentId: string }
  // One list per input item, in order; empty for items that are fine.
  | { ok: false; error: "invalid"; problems: BookingProblem[][] }
  | { ok: false; error: SaveError };

const ATTEMPTS = 3;

type ExistingItem = BookedItem & { id: string };

async function loadAppointment(supabase: Supabase, appointmentId: string) {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, status, client_id, notes, appointment_items(id, service_id, staff_id, resource_id, starts_at, active_minutes, processing_minutes, finishing_minutes)",
    )
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const items: ExistingItem[] = data.appointment_items.map((i) => ({
    id: i.id,
    appointmentId: data.id,
    serviceId: i.service_id,
    staffId: i.staff_id,
    resourceId: i.resource_id,
    start: new Date(i.starts_at),
    activeMinutes: i.active_minutes,
    processingMinutes: i.processing_minutes,
    finishingMinutes: i.finishing_minutes,
  }));
  return { status: data.status as AppointmentStatus, clientId: data.client_id, notes: data.notes, items };
}

// An existing item that the input leaves as it was.
function unchanged(input: BookingItemInput, old: ExistingItem): boolean {
  if (input.serviceId !== old.serviceId || input.staffId !== old.staffId || input.start.getTime() !== old.start.getTime()) return false;
  if (input.timing && durationMinutes(input.timing) !== durationMinutes(old)) return false;
  if (input.minutes && input.minutes !== durationMinutes(old)) return false;
  const r = input.resource;
  if (r.kind === "none") return old.resourceId == null;
  if (r.kind === "exact") return old.resourceId === r.id;
  return old.resourceId != null && r.prefer === old.resourceId;
}

export async function saveBooking(supabase: Supabase, location: Location, input: BookingInput): Promise<SaveResult> {
  if (input.items.length === 0) return { ok: false, error: "no_items" };

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // Read the version before the calendar, so any save after this point
    // makes ours fail and re-check.
    const version = await supabase.from("locations").select("calendar_version").eq("id", location.id).single();
    if (version.error) throw version.error;

    const existing = input.appointmentId ? await loadAppointment(supabase, input.appointmentId) : null;
    if (input.appointmentId && !existing) return { ok: false, error: "not_found" };
    if (existing && !isEditable(existing.status)) return { ok: false, error: "not_editable" };
    if (existing && input.seen && !stillAsSeen(input.seen, existing)) return { ok: false, error: "changed" };
    const oldById = new Map((existing?.items ?? []).map((i) => [i.id, i]));
    if (input.items.some((i) => i.id && !oldById.has(i.id))) return { ok: false, error: "not_found" };

    const dates = input.items.map((i) => toLocal(i.start, location.timezone).date).sort();
    const ctx = await loadBookingContext(supabase, location, dates[0], dates.at(-1)!);

    // Items to check: new ones and changed ones. Their old copies, and
    // removed items, no longer hold time.
    const changed = input.items.map((i) => !i.id || !unchanged(i, oldById.get(i.id)!));
    const kept = new Set(input.items.filter((i, n) => i.id && !changed[n]).map((i) => i.id!));
    const freed = new Set((existing?.items ?? []).filter((i) => !kept.has(i.id)).map((i) => i.id));
    const calendar = { ...ctx, booked: ctx.booked.filter((b) => !b.id || !freed.has(b.id)) };

    // Lengths given for this booking, as timings.
    const own: (ServiceTiming | undefined)[] = input.items.map((i) => {
      if (i.timing) return i.timing;
      const base = i.minutes ? timingFor(calendar, i.staffId, i.serviceId) : undefined;
      return base && i.minutes ? stretchTiming(base, i.minutes) : undefined;
    });

    const problems: BookingProblem[][] = input.items.map(() => []);
    const resources: (string | null)[] = input.items.map((i) => (i.id ? (oldById.get(i.id)!.resourceId ?? null) : null));
    const accepted: BookedItem[] = [];

    input.items.forEach((item, n) => {
      if (!changed[n]) return;
      const old = item.id ? oldById.get(item.id) : undefined;
      const service = calendar.services.get(item.serviceId);
      // A length given for this booking; else an item that keeps its
      // service keeps its booked timing; else the stylist's (in checkItem).
      const timing: ServiceTiming | undefined = own[n] ?? (old && old.serviceId === item.serviceId ? old : undefined);

      let resourceId: string | null = item.resource.kind === "exact" ? item.resource.id : null;
      if (item.resource.kind === "any" && (service || timing)) {
        const t = timing ?? timingFor(calendar, item.staffId, item.serviceId)!;
        const draft: BookedItem = { ...t, id: item.id, serviceId: item.serviceId, staffId: item.staffId, start: item.start };
        resourceId = pickResource(calendar, draft, item.resource.prefer ?? null, accepted);
        if (!resourceId) problems[n].push({ code: "no_free_resource" });
      }
      resources[n] = resourceId;

      const check = checkItem(calendar, { id: item.id, serviceId: item.serviceId, staffId: item.staffId, resourceId, start: item.start, timing }, accepted);
      if (check.valid) accepted.push(check.item);
      else problems[n].push(...check.problems);
    });

    if (problems.some((p) => p.length > 0)) return { ok: false, error: "invalid", problems };

    // Patch tests, when the salon makes them a hard requirement.
    const patch = await patchTestProblems(supabase, location, input.clientId, input.items.filter((_, n) => changed[n]));
    if (patch.size) return { ok: false, error: "invalid", problems: input.items.map((i, n) => (changed[n] && patch.has(i) ? [patch.get(i)!] : [])) };

    const { data, error } = await supabase.rpc("save_appointment", {
      p_location_id: location.id,
      p_appointment_id: input.appointmentId ?? null!,
      p_client_id: input.clientId!,
      p_notes: input.notes ?? "",
      p_items: input.items.map((item, n) => ({
        id: item.id ?? null,
        service_id: item.serviceId,
        staff_id: item.staffId,
        resource_id: resources[n],
        starts_at: item.start.toISOString(),
        timing: own[n] ? { active: own[n]!.activeMinutes, processing: own[n]!.processingMinutes, finishing: own[n]!.finishingMinutes } : null,
      })),
      p_expected_version: version.data.calendar_version,
    });
    // A stale calendar, or a clash the database caught (23P01): check again.
    if (error?.code === "40001" || error?.code === "23P01") continue;
    if (error?.code === "42501") return { ok: false, error: "forbidden" };
    // Not found, or a client, stylist, service or chair from elsewhere.
    if (error?.code === "P0002" || error?.code === "23503") return { ok: false, error: "not_found" };
    if (error) throw error;
    return { ok: true, appointmentId: data };
  }
  return { ok: false, error: "busy" };
}

// Moves one item of a visit to a new start time and/or stylist. It keeps
// its chair if that's free, otherwise takes a free one. The visit's other
// items stay where they are.
export async function moveItem(
  supabase: Supabase,
  location: Location,
  move: { itemId: string; staffId: string; start: Date },
): Promise<SaveResult> {
  const { data, error } = await supabase.from("appointment_items").select("appointment_id").eq("id", move.itemId).maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "not_found" };
  const appointment = await loadAppointment(supabase, data.appointment_id);
  if (!appointment) return { ok: false, error: "not_found" };

  return saveBooking(supabase, location, {
    appointmentId: data.appointment_id,
    clientId: appointment.clientId,
    notes: appointment.notes,
    items: appointment.items.map((i) =>
      i.id === move.itemId
        ? { id: i.id, serviceId: i.serviceId, staffId: move.staffId, start: move.start, resource: { kind: "any", prefer: i.resourceId } }
        : { id: i.id, serviceId: i.serviceId, staffId: i.staffId, start: i.start, resource: i.resourceId ? { kind: "exact", id: i.resourceId } : { kind: "none" } },
    ),
  });
}

// "patch_test": the salon blocks visits without a patch test in order, and
// this one's isn't (message: which services); a manager or owner can
// override it with a reason (checkInPatchOverride).
export type StatusResult = { ok: true } | { ok: false; error: "not_found" | "not_allowed" | "needs_reason" | "forbidden" } | { ok: false; error: "patch_test"; message: string };

const isPatchTestBlock = (e: { code?: string; hint?: string } | null) => e?.code === "55000" && e.hint === "patch_test";

export async function changeStatus(
  supabase: Supabase,
  appointmentId: string,
  action: AppointmentAction,
  reason: string | null = null,
): Promise<StatusResult> {
  const { data, error } = await supabase.from("appointments").select("status").eq("id", appointmentId).maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "not_found" };
  if (!allowedActions(data.status).includes(action)) return { ok: false, error: "not_allowed" };
  if (action === "cancel" && !reason?.trim()) return { ok: false, error: "needs_reason" };

  const { error: rpcError } = await supabase.rpc("set_appointment_status", {
    p_appointment_id: appointmentId,
    p_status: ACTION_STATUS[action],
    p_reason: reason ?? "",
  });
  if (rpcError?.code === "42501") return { ok: false, error: "forbidden" };
  if (isPatchTestBlock(rpcError)) return { ok: false, error: "patch_test", message: rpcError!.message };
  // It changed since it was read (checked out at the desk, say).
  if (rpcError?.code === "55000" && rpcError.hint === "status") return { ok: false, error: "not_allowed" };
  if (rpcError) throw rpcError;
  return { ok: true };
}

// A manager or owner checks a client in without the patch test the salon
// requires, saying why (logged in appointment_events).
export async function checkInPatchOverride(supabase: Supabase, appointmentId: string, reason: string): Promise<StatusResult> {
  if (!reason.trim()) return { ok: false, error: "needs_reason" };
  const { error } = await supabase.rpc("check_in_patch_override", { p_appointment_id: appointmentId, p_reason: reason.trim().slice(0, 300) });
  if (error?.code === "42501") return { ok: false, error: "forbidden" };
  if (error?.code === "22023") return { ok: false, error: "needs_reason" };
  if (error?.code === "55000") return { ok: false, error: "not_allowed" };
  if (error) throw error;
  return { ok: true };
}

// A check-in made by mistake: back to booked, clearing any service times
// tapped in since (undo_check_in logs who did it). Not once checked out:
// that's voiding the sale.
export async function undoCheckIn(supabase: Supabase, appointmentId: string): Promise<StatusResult> {
  const { data, error } = await supabase.from("appointments").select("status").eq("id", appointmentId).maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "not_found" };
  if (data.status !== "checked_in") return { ok: false, error: "not_allowed" };
  const { error: rpcError } = await supabase.rpc("undo_check_in", { p_appointment_id: appointmentId });
  if (rpcError?.code === "42501") return { ok: false, error: "forbidden" };
  if (rpcError?.code === "55000") return { ok: false, error: "not_allowed" };
  if (rpcError) throw rpcError;
  return { ok: true };
}

// A no-show marked by mistake, or a client who turned up after all: back to
// booked (or confirmed, as it was). The no-show freed its time, so the
// visit is checked against the booking rules again first; if someone's
// been booked in since, it's refused with what's in the way.
export type UndoNoShowResult = StatusResult | { ok: false; error: "invalid"; problems: BookingProblem[] } | { ok: false; error: "busy" };

export async function undoNoShow(supabase: Supabase, location: Location, appointmentId: string): Promise<UndoNoShowResult> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const version = await supabase.from("locations").select("calendar_version").eq("id", location.id).single();
    if (version.error) throw version.error;
    const visit = await loadAppointment(supabase, appointmentId);
    if (!visit) return { ok: false, error: "not_found" };
    if (visit.status !== "no_show") return { ok: false, error: "not_allowed" };
    const dates = visit.items.map((i) => toLocal(i.start, location.timezone).date).sort();
    const ctx = await loadBookingContext(supabase, location, dates[0], dates.at(-1)!);
    const own = new Set(visit.items.map((i) => i.id));
    const calendar = { ...ctx, booked: ctx.booked.filter((b) => !b.id || !own.has(b.id)) };
    const accepted: BookedItem[] = [];
    const problems: BookingProblem[] = [];
    for (const i of visit.items) {
      const check = checkItem(calendar, { id: i.id, serviceId: i.serviceId, staffId: i.staffId, resourceId: i.resourceId, start: i.start, timing: i }, accepted);
      if (check.valid) accepted.push(check.item);
      else problems.push(...check.problems);
    }
    if (problems.length) return { ok: false, error: "invalid", problems };
    const { error } = await supabase.rpc("undo_no_show", { p_appointment_id: appointmentId, p_expected_version: version.data.calendar_version });
    // A stale calendar, or a clash the database caught (23P01): check again.
    if (error?.code === "40001" || error?.code === "23P01") continue;
    if (error?.code === "42501") return { ok: false, error: "forbidden" };
    if (error?.code === "55000") return { ok: false, error: "not_allowed" };
    if (error) throw error;
    return { ok: true };
  }
  return { ok: false, error: "busy" };
}

export async function saveNotes(supabase: Supabase, appointmentId: string, notes: string): Promise<{ ok: boolean }> {
  const { error } = await supabase.rpc("set_appointment_notes", { p_appointment_id: appointmentId, p_notes: notes });
  if (error?.code === "42501") return { ok: false };
  if (error) throw error;
  return { ok: true };
}

// Items whose service needs a patch test the client doesn't have, when the
// salon blocks those bookings (otherwise it's a warning, shown elsewhere).
async function patchTestProblems(
  supabase: Supabase,
  location: Location,
  clientId: string | null,
  items: readonly BookingItemInput[],
): Promise<Map<BookingItemInput, BookingProblem>> {
  const found = new Map<BookingItemInput, BookingProblem>();
  if (!clientId || !items.length) return found;
  const { data: loc, error } = await supabase
    .from("locations")
    .select("business:businesses(patch_test_valid_days, patch_test_min_hours, patch_test_enforcement)")
    .eq("id", location.id)
    .single();
  if (error) throw error;
  if (loc.business.patch_test_enforcement !== "block") return found;
  const settings: PatchSettings = { validDays: loc.business.patch_test_valid_days, minHours: loc.business.patch_test_min_hours, enforcement: "block" };
  const [{ data: services, error: serviceError }, { data: tests, error: testError }] = await Promise.all([
    supabase.from("services").select("id").in("id", [...new Set(items.map((i) => i.serviceId))]).eq("requires_patch_test", true),
    supabase.from("client_patch_tests").select("tested_at, result").eq("client_id", clientId),
  ]);
  if (serviceError) throw serviceError;
  if (testError) throw testError;
  const needs = new Set(services.map((s) => s.id));
  const history = tests.map((t) => ({ testedAt: new Date(t.tested_at), result: t.result }));
  for (const item of items) {
    if (!needs.has(item.serviceId)) continue;
    const state = patchTestState(history, item.start, settings);
    if (state !== "ok") found.set(item, { code: "patch_test", state });
  }
  return found;
}
