// Whether an event's team is free for it, by the booking rules (time off,
// booked clients, blocked time, other events), leaving out the event's own
// hold on the calendar. Used when a booked event is saved (a clash stops
// the save), when the client books it (anyone no longer free is taken off
// their lane, so nobody is double-booked) and on the event page.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadBookingContext } from "@/lib/scheduling/load";
import { CLASH_TEXT, heldSpan, laneSpans, staffClash, type EventRole, type StaffClash, type TimelineTask } from "@/lib/scheduling/events";
import { toLocal, type LocalDate } from "@/lib/scheduling/time";

type Supabase = SupabaseClient<Database>;

export type TeamClash = { staffId: string; role: EventRole; clash: StaffClash; text: string };

export async function eventClashes(
  supabase: Supabase,
  location: { id: string; timezone: string },
  input: { eventId: string | null; date: LocalDate; tasks: readonly (Pick<TimelineTask, "role" | "lane" | "start" | "end"> & { staffId: string | null })[]; travelMinutes: number },
): Promise<TeamClash[]> {
  const staffed = input.tasks.filter((t) => t.staffId);
  if (!staffed.length) return [];
  const ids = [...new Set(staffed.map((t) => t.staffId!))];
  const [ctx, staff, own] = await Promise.all([
    loadBookingContext(supabase, location, input.date, input.date),
    supabase.from("staff").select("id, event_roles").in("id", ids),
    input.eventId ? supabase.from("time_blocks").select("id").eq("event_id", input.eventId) : Promise.resolve({ data: [], error: null }),
  ]);
  if (staff.error) throw staff.error;
  if (own.error) throw own.error;
  const ownIds = new Set(own.data.map((b) => b.id));
  const roles = new Map(staff.data.map((s) => [s.id, s.event_roles]));
  const clashes: TeamClash[] = [];
  for (const staffId of ids) {
    // Everything this person does at the event, as one hold.
    for (const span of laneSpans(staffed.filter((t) => t.staffId === staffId).map((t) => ({ ...t, lane: 1 })))) {
      const clash = staffClash(ctx, { id: staffId, eventRoles: roles.get(staffId) ?? [] }, span.role, input.date, heldSpan(span, input.travelMinutes), ownIds);
      if (clash) clashes.push({ staffId, role: span.role, clash, text: CLASH_TEXT[clash] });
    }
  }
  return clashes;
}

// After the client books: anyone on the team who's become busy since (a
// client booked with them, time off) comes off their lane, and the desk is
// told (release_event_staff). Service role.
export async function releaseBusyTeam(admin: Supabase, eventId: string): Promise<string[]> {
  const { data: e, error } = await admin
    .from("events")
    .select("event_date, on_location, travel_minutes, location:locations(id, timezone), event_tasks(role, lane, staff_id, starts_at, ends_at)")
    .eq("id", eventId)
    .single();
  if (error) throw error;
  const tz = e.location!.timezone;
  const minute = (iso: string) => toLocal(new Date(iso), tz).minute;
  const clashes = await eventClashes(admin, e.location!, {
    eventId,
    date: e.event_date,
    tasks: e.event_tasks.map((t) => ({ role: t.role as EventRole, lane: t.lane, start: minute(t.starts_at), end: minute(t.ends_at), staffId: t.staff_id })),
    travelMinutes: e.on_location ? e.travel_minutes : 0,
  });
  const busy = [...new Set(clashes.map((c) => c.staffId))];
  if (busy.length) {
    const { error: released } = await admin.rpc("release_event_staff", { p_event_id: eventId, p_staff_ids: busy });
    if (released) throw released;
  }
  return busy;
}
