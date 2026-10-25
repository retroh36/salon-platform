// Loads the booked events coming up at a location and checks them
// (eventRisks): payments still to come, the trial, the cutoff, and whether
// everyone on the team is still free by the booking rules (eventClashes).
// Front of house: payments are theirs (RLS).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { laneSpans, type EventRole } from "@/lib/scheduling/events";
import { toLocal, type LocalDate } from "@/lib/scheduling/time";
import { eventClashes } from "./clashes";
import { loadEventSettings } from "./load";
import { headcountCutoff } from "./pricing";
import { eventRisks, riskHorizon, type EventRisk, type RiskEvent } from "./risks";

type Supabase = SupabaseClient<Database>;

export async function loadEventRisks(supabase: Supabase, where: { businessId: string; location: { id: string; timezone: string } }, today: LocalDate): Promise<EventRisk[]> {
  const tz = where.location.timezone;
  const [{ data, error }, settings] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, status, event_date, on_location, travel_minutes, event_tasks(role, lane, staff_id, starts_at, ends_at), event_payments(status, amount_cents), appointments(status)")
      .eq("location_id", where.location.id)
      .in("status", ["booked", "trial_done"])
      .gte("event_date", today)
      .lte("event_date", riskHorizon(today))
      .order("event_date"),
    loadEventSettings(supabase, where.businessId),
  ]);
  if (error) throw error;
  if (!data.length) return [];
  const { data: staff, error: staffError } = await supabase.from("staff").select("id, first_name").eq("business_id", where.businessId);
  if (staffError) throw staffError;
  const nameOf = new Map(staff.map((s) => [s.id, s.first_name]));
  const minute = (iso: string) => toLocal(new Date(iso), tz).minute;

  const events: RiskEvent[] = await Promise.all(
    data.map(async (e) => {
      const tasks = e.event_tasks.map((t) => ({ role: t.role as EventRole, lane: t.lane, start: minute(t.starts_at), end: minute(t.ends_at), staffId: t.staff_id }));
      const clashes = await eventClashes(supabase, where.location, { eventId: e.id, date: e.event_date, tasks, travelMinutes: e.on_location ? e.travel_minutes : 0 });
      const owed = e.event_payments.filter((p) => p.status === "scheduled" || p.status === "failed");
      return {
        id: e.id,
        name: e.title,
        date: e.event_date,
        status: e.status,
        unpaidCents: owed.reduce((n, p) => n + p.amount_cents, 0),
        failedPayment: owed.some((p) => p.status === "failed"),
        trialMissing: settings.trialServiceId !== null && !e.appointments.some((a) => a.status !== "canceled"),
        cutoff: headcountCutoff(e.event_date, settings),
        openLanes: laneSpans(tasks).filter((s) => !tasks.some((t) => t.role === s.role && t.lane === s.lane && t.staffId)).length,
        busyTeam: [...new Map(clashes.map((c) => [c.staffId, c])).values()].map((c) => ({ staffId: c.staffId, name: nameOf.get(c.staffId) ?? "Someone", timeOff: c.clash === "time_off", text: c.text })),
      };
    }),
  );
  return eventRisks(events, today);
}
