import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { dayView } from "@/lib/scheduling/availability";
import { FREE_STATUSES, loadLocationSchedule, loadStaffSchedules, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, MINUTES_PER_DAY, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { intersectIntervals, subtractIntervals, type Interval } from "@/lib/scheduling/intervals";
import { fullName, sortForCalendar } from "@/lib/staff";
import { doubledUp, stationDay, type FloorUse, type StationKind } from "@/lib/stations";

type Supabase = SupabaseClient<Database>;

export type FloorStation = {
  id: string;
  name: string;
  kind: StationKind;
  area: string | null;
  homeStaffId: string | null;
  uses: FloorUse[];
  // Clients booked into it (rooms, the barber station): first names only.
  visits: { start: number; end: number; client: string; stylist: string }[];
  clashes: [FloorUse, FloorUse][];
};

export type Floor = {
  date: LocalDate;
  open: Interval[];
  stations: FloorStation[];
  // Who's working that day, for lending a chair.
  working: { id: string; name: string; firstName: string; hours: Interval[]; hasChair: boolean }[];
};

// A location's stations on a day: who's at each one and when (its own
// stylist while they work, anyone it's lent to), and clients booked into it.
export async function loadFloor(supabase: Supabase, location: { id: string; timezone: string }, date: LocalDate): Promise<Floor> {
  const tz = location.timezone;
  const [resources, team, lent, items, locationSchedule] = await Promise.all([
    supabase.from("resources").select("id, name, kind, area, sort_order").eq("location_id", location.id).eq("is_active", true).order("sort_order").order("name"),
    supabase.from("staff").select("id, first_name, last_name, role, is_active, calendar_position, home_resource_id").eq("location_id", location.id).eq("is_active", true),
    supabase.from("station_assignments").select("id, resource_id, staff_id, start_minute, end_minute").eq("location_id", location.id).eq("on_date", date),
    supabase
      .from("appointment_items")
      .select("resource_id, staff_id, starts_at, active_minutes, processing_minutes, finishing_minutes, appointment:appointments!inner(status, client:clients(first_name))")
      .eq("location_id", location.id)
      .not("resource_id", "is", null)
      .gte("starts_at", startOfLocalDay(date, tz).toISOString())
      .lt("starts_at", startOfLocalDay(addDays(date, 1), tz).toISOString())
      .not("appointment.status", "in", `(${FREE_STATUSES.join(",")})`),
    loadLocationSchedule(supabase, location),
  ]);
  if (resources.error) throw resources.error;
  if (team.error) throw team.error;
  if (lent.error) throw lent.error;
  if (items.error) throw items.error;

  const people = sortForCalendar(team.data);
  const schedules = await loadStaffSchedules(supabase, people.map((p) => p.id), date, date);
  const open = dayView({ weekly: {}, overrides: {}, timeOff: [] }, locationSchedule, date).open;
  const working = new Map(
    people.map((p) => {
      const day = dayView(schedules.get(p.id)!, locationSchedule, date);
      const off = day.timeOff.filter((t) => t.status === "approved").map((t) => (t.startMinute != null && t.endMinute != null ? { start: t.startMinute, end: t.endMinute } : { start: 0, end: MINUTES_PER_DAY }));
      return [p.id, subtractIntervals(intersectIntervals(day.hours, day.open), off)];
    }),
  );
  const names = new Map(people.map((p) => [p.id, p.first_name]));
  const loans = lent.data.map((l) => ({ id: l.id, resourceId: l.resource_id, staffId: l.staff_id, start: l.start_minute, end: l.end_minute }));

  const stations: FloorStation[] = resources.data.map((r) => {
    const homeStaffId = people.find((p) => p.home_resource_id === r.id)?.id ?? null;
    const uses = stationDay({ id: r.id, homeStaffId }, working, loans, names);
    const visits = items.data
      .filter((i) => i.resource_id === r.id)
      .map((i) => {
        const start = toLocal(new Date(i.starts_at), tz).minute;
        return { start, end: Math.min(start + i.active_minutes + i.processing_minutes + i.finishing_minutes, MINUTES_PER_DAY), client: i.appointment.client?.first_name ?? "Walk-in", stylist: names.get(i.staff_id) ?? "" };
      })
      .sort((a, b) => a.start - b.start);
    return { id: r.id, name: r.name, kind: r.kind as StationKind, area: r.area, homeStaffId, uses, visits, clashes: doubledUp(uses) };
  });

  return {
    date,
    open,
    stations,
    working: people
      .filter((p) => (working.get(p.id) ?? []).length > 0)
      .map((p) => ({ id: p.id, name: fullName(p), firstName: p.first_name, hours: working.get(p.id)!, hasChair: stations.some((s) => s.uses.some((u) => u.staffId === p.id)) })),
  };
}
