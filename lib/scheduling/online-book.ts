// Saving online bookings: the booking site's counterpart of ./book.ts.
//
// The visit is planned again (./online.ts) against the calendar as it is
// now, with the same booking rules, and saved through the database's
// save_online_appointment with the calendar version it was checked
// against. If anyone saved in the meantime the database refuses and this
// plans again, so two people can never get the same time: the second gets
// "taken" (or, with no preference, another free stylist at that time).
//
// Patch tests always block online, whatever the salon does at the desk.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadBookingContext } from "./load.ts";
import { planVisitAt, type PlannedItem, type VisitRequest } from "./online.ts";
import { patchTestState, type PatchSettings, type PatchState } from "./patch-tests.ts";
import { toLocal } from "./time.ts";

type Supabase = SupabaseClient<Database>;
type Location = { id: string; timezone: string };

export type OnlineBookingInput = {
  // Set to reschedule a visit booked online (with its manage link's hash).
  appointmentId?: string;
  clientId: string;
  notes: string | null;
  request: VisitRequest;
  start: Date;
  manageTokenHash: string;
};

export type OnlineBookResult =
  | { ok: true; appointmentId: string; items: PlannedItem[] }
  | { ok: false; error: "taken" | "busy" | "not_found" }
  | { ok: false; error: "patch_test"; serviceIds: string[]; state: Exclude<PatchState, "ok"> };

const ATTEMPTS = 3;

export async function bookOnline(admin: Supabase, location: Location, input: OnlineBookingInput): Promise<OnlineBookResult> {
  const date = toLocal(input.start, location.timezone).date;

  const patch = await patchTestProblems(admin, location, input.clientId, input.request.serviceIds, input.start);
  if (patch) return { ok: false, error: "patch_test", ...patch };

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const version = await admin.from("locations").select("calendar_version").eq("id", location.id).single();
    if (version.error) throw version.error;

    const ctx = await loadBookingContext(admin, location, date, date);
    const items = planVisitAt(ctx, input.request, input.start, { replacingAppointmentId: input.appointmentId });
    if (!items) return { ok: false, error: "taken" };

    const { data, error } = await admin.rpc("save_online_appointment", {
      p_location_id: location.id,
      p_appointment_id: input.appointmentId ?? null!,
      p_client_id: input.clientId,
      p_notes: input.notes ?? "",
      p_items: items.map((i) => ({ id: null, service_id: i.serviceId, staff_id: i.staffId, resource_id: i.resourceId, starts_at: i.start.toISOString() })),
      p_expected_version: version.data.calendar_version,
      p_manage_token_hash: input.manageTokenHash,
    });
    if (error?.code === "40001") continue;
    if (error?.code === "P0002") return { ok: false, error: "not_found" };
    if (error) throw error;
    return { ok: true, appointmentId: data, items };
  }
  return { ok: false, error: "busy" };
}

// The services of the visit that need a patch test the client doesn't have
// (or it's expired, too recent, or showed a reaction), by the salon's rules.
export async function patchTestProblems(
  admin: Supabase,
  location: Location,
  clientId: string | null,
  serviceIds: readonly string[],
  start: Date,
): Promise<{ serviceIds: string[]; state: Exclude<PatchState, "ok"> } | null> {
  const [{ data: loc, error }, { data: services, error: serviceError }] = await Promise.all([
    admin.from("locations").select("business:businesses(patch_test_valid_days, patch_test_min_hours)").eq("id", location.id).single(),
    admin.from("services").select("id").in("id", [...serviceIds]).eq("requires_patch_test", true),
  ]);
  if (error) throw error;
  if (serviceError) throw serviceError;
  if (services.length === 0) return null;

  let history: { testedAt: Date; result: "no_reaction" | "reaction" }[] = [];
  if (clientId) {
    const { data: tests, error: testError } = await admin.from("client_patch_tests").select("tested_at, result").eq("client_id", clientId);
    if (testError) throw testError;
    history = tests.map((t) => ({ testedAt: new Date(t.tested_at), result: t.result }));
  }
  const settings: PatchSettings = { validDays: loc.business.patch_test_valid_days, minHours: loc.business.patch_test_min_hours, enforcement: "block" };
  const state = patchTestState(history, start, settings);
  return state === "ok" ? null : { serviceIds: services.map((s) => s.id), state };
}

export async function cancelOnline(admin: Supabase, appointmentId: string, manageTokenHash: string): Promise<{ ok: boolean }> {
  const { error } = await admin.rpc("cancel_online_appointment", { p_appointment_id: appointmentId, p_manage_token_hash: manageTokenHash });
  if (error?.code === "P0002") return { ok: false };
  if (error) throw error;
  return { ok: true };
}
