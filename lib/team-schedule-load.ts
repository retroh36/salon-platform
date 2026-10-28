import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { staffPhotoUrl } from "@/lib/branding";
import { dayView, hoursOn, type WeeklyHours } from "@/lib/scheduling/availability";
import { FREE_STATUSES, loadLocationSchedule, loadStaffSchedules, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, datesBetween, MINUTES_PER_DAY, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { fullName, sortForCalendar, type StaffRole } from "@/lib/staff";
import { cellKey, type BookedSpan, type Cell, type Shift } from "./team-schedule";

type Supabase = SupabaseClient<Database>;

export type GridPerson = {
  id: string;
  name: string;
  firstName: string;
  role: StaffRole;
  level: "artisan" | "senior" | "master" | null;
  color: string | null;
  photoUrl: string | null;
  cycleWeeks: number;
  // Their repeating pattern: a week's shifts for each week of the cycle.
  pattern: { startsOn: LocalDate | null; weeks: WeeklyHours[] };
  // Their home chair's name.
  chair: string | null;
};

export type WeekGrid = {
  week: LocalDate;
  dates: LocalDate[];
  people: GridPerson[];
  // This week's cells, then last week's (for Copy last week).
  cells: Cell[];
  lastWeek: Cell[];
  // When the salon is open each day.
  open: Record<LocalDate, Shift[]>;
  lastPublished: { at: string; by: string } | null;
  // A chair lent to someone on a day, by cellKey: its name.
  lentChairs: Record<string, string>;
};

// A week of the team schedule at a location: everyone active, what's
// published, the draft (for those who can see it: RLS shows drafts to
// owners and managers only), approved time off and booked clients.
export async function loadWeekGrid(supabase: Supabase, location: { id: string; timezone: string }, week: LocalDate, { drafts }: { drafts: boolean }): Promise<WeekGrid> {
  const tz = location.timezone;
  const from = addDays(week, -7);
  const to = addDays(week, 6);
  const dates = datesBetween(week, to);
  const lastDates = datesBetween(from, addDays(week, -1));

  const { data: staff, error } = await supabase
    .from("staff")
    .select("id, first_name, last_name, role, level, color, photo_path, is_active, calendar_position, hours_cycle_weeks, hours_cycle_starts_on, home_resource_id")
    .eq("location_id", location.id)
    .eq("is_active", true);
  if (error) throw error;
  const team = sortForCalendar(staff);
  const ids = team.map((s) => s.id);

  const [locationSchedule, schedules, draftRows, items, publish, resources, lent] = await Promise.all([
    loadLocationSchedule(supabase, location),
    loadStaffSchedules(supabase, ids, from, to),
    drafts
      ? supabase.from("schedule_drafts").select("staff_id, on_date, shifts").eq("location_id", location.id).gte("on_date", from).lte("on_date", to)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("appointment_items")
      .select("staff_id, appointment_id, starts_at, active_minutes, processing_minutes, finishing_minutes, appointment:appointments!inner(status, client:clients(first_name, last_name))")
      .eq("location_id", location.id)
      .gte("starts_at", startOfLocalDay(week, tz).toISOString())
      .lt("starts_at", startOfLocalDay(addDays(to, 1), tz).toISOString())
      .not("appointment.status", "in", `(${FREE_STATUSES.join(",")})`)
      .limit(5000),
    supabase
      .from("schedule_publishes")
      .select("published_at, publisher:staff!schedule_publishes_published_by_business_id_fkey(first_name)")
      .eq("location_id", location.id)
      .eq("week_start", week)
      .order("published_at", { ascending: false })
      .limit(1),
    supabase.from("resources").select("id, name").eq("location_id", location.id),
    supabase.from("station_assignments").select("resource_id, staff_id, on_date").eq("location_id", location.id).gte("on_date", week).lte("on_date", to),
  ]);
  if (resources.error) throw resources.error;
  if (lent.error) throw lent.error;
  const resourceName = new Map(resources.data.map((r) => [r.id, r.name]));
  if (draftRows.error) throw draftRows.error;
  if (items.error) throw items.error;
  if (publish.error) throw publish.error;

  const draftOf = new Map(draftRows.data.map((d) => [cellKey(d.staff_id, d.on_date), d.shifts as Shift[]]));
  const booked = new Map<string, BookedSpan[]>();
  for (const i of items.data) {
    const { date, minute } = toLocal(new Date(i.starts_at), tz);
    const client = i.appointment.client ? fullName(i.appointment.client) : "Walk-in";
    const spans = [
      { start: minute, end: minute + i.active_minutes },
      ...(i.finishing_minutes ? [{ start: minute + i.active_minutes + i.processing_minutes, end: minute + i.active_minutes + i.processing_minutes + i.finishing_minutes }] : []),
    ];
    const list = booked.get(cellKey(i.staff_id, date)) ?? [];
    for (const s of spans) list.push({ appointmentId: i.appointment_id, client, start: s.start, end: Math.min(s.end, MINUTES_PER_DAY) });
    booked.set(cellKey(i.staff_id, date), list);
  }

  const cellFor = (id: string, date: LocalDate): Cell => {
    const schedule = schedules.get(id)!;
    const day = dayView(schedule, locationSchedule, date);
    return {
      staffId: id,
      date,
      live: hoursOn(schedule, date),
      draft: draftOf.get(cellKey(id, date)) ?? null,
      timeOff: day.timeOff
        .filter((t) => t.status === "approved")
        .map((t) => (t.startMinute != null && t.endMinute != null ? { start: t.startMinute, end: t.endMinute } : { start: 0, end: MINUTES_PER_DAY })),
      booked: (booked.get(cellKey(id, date)) ?? []).sort((a, b) => a.start - b.start),
    };
  };

  return {
    week,
    dates,
    people: team.map((s) => ({
      id: s.id,
      name: fullName(s),
      firstName: s.first_name,
      role: s.role,
      level: s.level,
      color: s.color,
      photoUrl: staffPhotoUrl(s.photo_path),
      cycleWeeks: s.hours_cycle_weeks,
      pattern: { startsOn: s.hours_cycle_starts_on, weeks: schedules.get(s.id)!.cycle?.weeks ?? [schedules.get(s.id)!.weekly] },
      chair: s.home_resource_id ? (resourceName.get(s.home_resource_id) ?? null) : null,
    })),
    cells: ids.flatMap((id) => dates.map((d) => cellFor(id, d))),
    lastWeek: ids.flatMap((id) => lastDates.map((d) => cellFor(id, d))),
    open: Object.fromEntries(dates.map((d) => [d, dayView({ weekly: {}, overrides: {}, timeOff: [] }, locationSchedule, d).open])),
    lastPublished: publish.data[0] ? { at: publish.data[0].published_at, by: publish.data[0].publisher?.first_name ?? "" } : null,
    lentChairs: Object.fromEntries(lent.data.map((l) => [cellKey(l.staff_id, l.on_date), resourceName.get(l.resource_id) ?? ""])),
  };
}
