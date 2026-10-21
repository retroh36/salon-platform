import type { createClient } from "@/lib/supabase/server";
import type { LocationSchedule, StaffSchedule, TimeOff, WeeklyHours } from "./availability";
import type { Interval } from "./intervals";
import type { LocalDate, Weekday } from "./time";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type HourRow = { weekday: number; start_minute: number; end_minute: number };

function toWeekly(rows: HourRow[]): WeeklyHours {
  const weekly: WeeklyHours = {};
  for (const r of rows) {
    const day = r.weekday as Weekday;
    (weekly[day] ??= []).push({ start: r.start_minute, end: r.end_minute });
  }
  return weekly;
}

export async function loadLocationSchedule(
  supabase: Supabase,
  location: { id: string; timezone: string },
): Promise<LocationSchedule> {
  const { data, error } = await supabase
    .from("location_hours")
    .select("weekday, start_minute, end_minute")
    .eq("location_id", location.id);
  if (error) throw error;
  return { timeZone: location.timezone, weekly: toWeekly(data) };
}

// Schedules for the given staff between two local dates (inclusive). Time off
// includes every status the caller can see (RLS hides other people's
// pending and declined requests); availability only counts approved.
export async function loadStaffSchedules(
  supabase: Supabase,
  staffIds: string[],
  from: LocalDate,
  to: LocalDate,
): Promise<Map<string, StaffSchedule>> {
  const [hours, overrides, timeOff] = await Promise.all([
    supabase.from("staff_working_hours").select("staff_id, weekday, start_minute, end_minute").in("staff_id", staffIds),
    supabase
      .from("staff_schedule_overrides")
      .select("staff_id, on_date, start_minute, end_minute")
      .in("staff_id", staffIds)
      .gte("on_date", from)
      .lte("on_date", to),
    supabase
      .from("staff_time_off")
      .select("id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status")
      .in("staff_id", staffIds)
      .lte("starts_on", to)
      .gte("ends_on", from)
      .order("starts_on"),
  ]);
  if (hours.error) throw hours.error;
  if (overrides.error) throw overrides.error;
  if (timeOff.error) throw timeOff.error;

  const schedules = new Map<string, StaffSchedule>(
    staffIds.map((id) => [
      id,
      {
        weekly: toWeekly(hours.data.filter((r) => r.staff_id === id)),
        overrides: {} as Record<LocalDate, Interval[]>,
        timeOff: [] as TimeOff[],
      },
    ]),
  );

  for (const o of overrides.data) {
    (schedules.get(o.staff_id)!.overrides[o.on_date] ??= []).push({ start: o.start_minute, end: o.end_minute });
  }
  for (const t of timeOff.data) {
    schedules.get(t.staff_id)!.timeOff.push({
      id: t.id,
      startsOn: t.starts_on,
      endsOn: t.ends_on,
      startMinute: t.start_minute,
      endMinute: t.end_minute,
      status: t.status,
      reason: t.reason,
      note: t.note,
    });
  }
  return schedules;
}
