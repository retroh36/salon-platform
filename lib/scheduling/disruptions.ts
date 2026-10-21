// What staff report when the day goes off plan: a visit running over, a
// client running late, a stylist out for the rest of the day. Saved through
// the database's report_running_late and report_call_out; read by the
// conflict resolver (./resolve.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Disruption } from "./resolve.ts";
import type { LocalDate } from "./time.ts";

type Supabase = SupabaseClient<Database>;

// Choices for "Running late", in minutes.
export const LATE_MINUTES = [5, 10, 15, 20, 30, 45, 60];

export type ReportResult = { ok: true; id: string } | { ok: false; error: "forbidden" | "over" | "invalid" };

function reportError(code: string | undefined): ReportResult | null {
  if (code === "42501") return { ok: false, error: "forbidden" };
  if (code === "55000") return { ok: false, error: "over" };
  if (code === "22023") return { ok: false, error: "invalid" };
  return null;
}

// For a client who's checked in, the visit (this item) is running over; for
// one who hasn't arrived yet, the client is late. A new estimate replaces
// the last one.
export async function reportRunningLate(supabase: Supabase, itemId: string, minutes: number): Promise<ReportResult> {
  const { data, error } = await supabase.rpc("report_running_late", { p_item_id: itemId, p_minutes: minutes });
  const known = reportError(error?.code);
  if (known) return known;
  if (error) throw error;
  return { ok: true, id: data };
}

// The stylist is out from `from` to the end of that day.
export async function reportCallOut(supabase: Supabase, staffId: string, from: Date): Promise<ReportResult> {
  const { data, error } = await supabase.rpc("report_call_out", { p_staff_id: staffId, p_from: from.toISOString() });
  const known = reportError(error?.code);
  if (known) return known;
  if (error) throw error;
  return { ok: true, id: data };
}

// The reports for a day that the resolver should consider: late clients
// whose visit hasn't been moved for it yet, and every overrun and call-out.
export async function loadDisruptions(supabase: Supabase, locationId: string, date: LocalDate): Promise<Disruption[]> {
  const { data, error } = await supabase
    .from("schedule_disruptions")
    .select("id, kind, item_id, appointment_id, staff_id, minutes, starts_at, resolved_by_action")
    .eq("location_id", locationId)
    .eq("on_date", date)
    .order("created_at");
  if (error) throw error;
  const disruptions: Disruption[] = [];
  for (const d of data) {
    if (d.kind === "overrun" && d.item_id && d.minutes) disruptions.push({ id: d.id, kind: "overrun", itemId: d.item_id, minutes: d.minutes });
    if (d.kind === "client_late" && d.appointment_id && d.minutes && !d.resolved_by_action) {
      disruptions.push({ id: d.id, kind: "client_late", appointmentId: d.appointment_id, minutes: d.minutes });
    }
    if (d.kind === "call_out" && d.staff_id && d.starts_at) disruptions.push({ id: d.id, kind: "call_out", staffId: d.staff_id, from: new Date(d.starts_at) });
  }
  return disruptions;
}
