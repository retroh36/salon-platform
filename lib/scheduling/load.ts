import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { LocationSchedule, StaffSchedule, TimeOff, WeeklyHours } from "./availability.ts";
import { occurrences, occurrenceSpan, type BlockOccurrence, type TimeBlock } from "./blocks.ts";
import type { BlockedTime, BookedItem, BookingContext, ServiceTiming } from "./booking.ts";
import type { Interval } from "./intervals.ts";
import { addDays, fromLocal, MINUTES_PER_DAY, type LocalDate, type Weekday } from "./time.ts";

type Supabase = SupabaseClient<Database>;

type HourRow = { weekday: number; start_minute: number; end_minute: number; cycle_week?: number };

export function toWeekly(rows: HourRow[]): WeeklyHours {
  const weekly: WeeklyHours = {};
  for (const r of rows) {
    const day = r.weekday as Weekday;
    (weekly[day] ??= []).push({ start: r.start_minute, end: r.end_minute });
  }
  // Earliest shift first, whatever order the rows came back in: pages show
  // them as they are ("9am–1pm, 2pm–6pm").
  for (const shifts of Object.values(weekly)) shifts.sort((a, b) => a.start - b.start);
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

// A repeating pattern's weeks, from its rows (null for a one-week pattern).
export function toCycle(rows: HourRow[], weeks: number, startsOn: LocalDate | null): StaffSchedule["cycle"] {
  if (weeks <= 1 || !startsOn) return null;
  return { startsOn, weeks: Array.from({ length: weeks }, (_, n) => toWeekly(rows.filter((r) => (r.cycle_week ?? 0) === n))) };
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
  const [hours, cycles, overrides, daysOff, timeOff] = await Promise.all([
    supabase.from("staff_working_hours").select("staff_id, cycle_week, weekday, start_minute, end_minute").in("staff_id", staffIds),
    supabase.from("staff").select("id, hours_cycle_weeks, hours_cycle_starts_on").in("id", staffIds),
    supabase
      .from("staff_schedule_overrides")
      .select("staff_id, on_date, start_minute, end_minute")
      .in("staff_id", staffIds)
      .gte("on_date", from)
      .lte("on_date", to),
    supabase.from("staff_days_off").select("staff_id, on_date").in("staff_id", staffIds).gte("on_date", from).lte("on_date", to),
    supabase
      .from("staff_time_off")
      .select("id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status")
      .in("staff_id", staffIds)
      .lte("starts_on", to)
      .gte("ends_on", from)
      .order("starts_on"),
  ]);
  if (hours.error) throw hours.error;
  if (cycles.error) throw cycles.error;
  if (overrides.error) throw overrides.error;
  if (daysOff.error) throw daysOff.error;
  const cycleOf = new Map(cycles.data.map((c) => [c.id, c]));
  if (timeOff.error) throw timeOff.error;

  const schedules = new Map<string, StaffSchedule>(
    staffIds.map((id) => [
      id,
      {
        weekly: toWeekly(hours.data.filter((r) => r.staff_id === id && r.cycle_week === 0)),
        cycle: toCycle(
          hours.data.filter((r) => r.staff_id === id),
          cycleOf.get(id)?.hours_cycle_weeks ?? 1,
          cycleOf.get(id)?.hours_cycle_starts_on ?? null,
        ),
        overrides: {} as Record<LocalDate, Interval[]>,
        timeOff: [] as TimeOff[],
      },
    ]),
  );

  for (const o of overrides.data) {
    (schedules.get(o.staff_id)!.overrides[o.on_date] ??= []).push({ start: o.start_minute, end: o.end_minute });
  }
  // A day off in a published week: no hours that day.
  for (const d of daysOff.data) schedules.get(d.staff_id)!.overrides[d.on_date] = [];
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

// The first instant of a local date. Midnight is skipped on a few zones'
// daylight saving days; then the day starts at the first minute that exists.
export function startOfLocalDay(date: LocalDate, timeZone: string): Date {
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += 15) {
    const instant = fromLocal(date, minute, timeZone);
    if (instant) return instant;
  }
  throw new Error(`No start of day for ${date} in ${timeZone}`);
}

// Appointment statuses whose items don't hold time on the calendar.
export const FREE_STATUSES = ["canceled", "no_show"] as const;

const ITEM_FIELDS =
  "id, appointment_id, service_id, staff_id, resource_id, starts_at, active_minutes, processing_minutes, finishing_minutes";

type ItemRow = {
  id: string;
  appointment_id: string;
  service_id: string;
  staff_id: string;
  resource_id: string | null;
  starts_at: string;
  active_minutes: number;
  processing_minutes: number;
  finishing_minutes: number;
};

export function toBookedItem(row: ItemRow): BookedItem {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    serviceId: row.service_id,
    staffId: row.staff_id,
    resourceId: row.resource_id,
    start: new Date(row.starts_at),
    activeMinutes: row.active_minutes,
    processingMinutes: row.processing_minutes,
    finishingMinutes: row.finishing_minutes,
  };
}

// Items at a location that hold time between two local dates (inclusive):
// everything except canceled appointments and no-shows.
export async function loadBookedItems(
  supabase: Supabase,
  location: { id: string; timezone: string },
  from: LocalDate,
  to: LocalDate,
): Promise<BookedItem[]> {
  const start = startOfLocalDay(from, location.timezone).toISOString();
  const end = startOfLocalDay(addDays(to, 1), location.timezone).toISOString();
  const items: BookedItem[] = [];
  // Pages of 1,000, the API's row limit.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("appointment_items")
      .select(`${ITEM_FIELDS}, appointment:appointments!inner(status)`)
      .eq("location_id", location.id)
      .lt("starts_at", end)
      .gt("ends_at", start)
      .not("appointment.status", "in", `(${FREE_STATUSES.join(",")})`)
      .order("starts_at")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    items.push(...data.map(toBookedItem));
    if (data.length < 1000) break;
  }
  return items;
}

// Everything checkItem needs to check bookings at a location between two
// local dates (inclusive).
export async function loadBookingContext(
  supabase: Supabase,
  location: { id: string; timezone: string },
  from: LocalDate,
  to: LocalDate,
): Promise<BookingContext> {
  // The location's business: RLS limits staff to their own salon, but the
  // booking site reads with the service role.
  const business = await supabase.from("locations").select("business_id").eq("id", location.id).single();
  if (business.error) throw business.error;
  const [staff, services, resources] = await Promise.all([
    supabase.from("staff").select("id, is_active").eq("location_id", location.id),
    supabase.from("services").select("id, active_minutes, processing_minutes, finishing_minutes, archived_at").eq("business_id", business.data.business_id),
    supabase.from("resources").select("id, is_active, kind, sort_order").eq("location_id", location.id),
  ]);
  if (staff.error) throw staff.error;
  if (services.error) throw services.error;
  if (resources.error) throw resources.error;

  const staffIds = staff.data.map((s) => s.id);
  const [locationSchedule, schedules, booked, offers, blocks, timings] = await Promise.all([
    loadLocationSchedule(supabase, location),
    loadStaffSchedules(supabase, staffIds, from, to),
    loadBookedItems(supabase, location, from, to),
    loadOffers(supabase, staffIds),
    loadBlockOccurrences(supabase, location.id, from, to),
    loadStaffTimings(supabase, staffIds),
  ]);

  return {
    location: locationSchedule,
    services: new Map(
      services.data.map((s) => [
        s.id,
        {
          id: s.id,
          activeMinutes: s.active_minutes,
          processingMinutes: s.processing_minutes,
          finishingMinutes: s.finishing_minutes,
          archived: s.archived_at !== null,
        },
      ]),
    ),
    staff: new Map(
      staff.data.map((s) => [
        s.id,
        {
          id: s.id,
          isActive: s.is_active,
          schedule: schedules.get(s.id)!,
          serviceIds: new Set(offers.get(s.id)?.keys()),
          timings: timings.get(s.id),
        },
      ]),
    ),
    resources: new Map(resources.data.map((r) => [r.id, { id: r.id, isActive: r.is_active, kind: r.kind, sortOrder: r.sort_order }])),
    booked,
    blocks: blockedTimes(blocks, location.timezone),
  };
}

// A short string that changes whenever the location's calendar does: its
// calendar version (bumped by every booking save) and the latest change to
// any of its appointments (status, notes, cancellations).
export async function loadCalendarStamp(supabase: Supabase, locationId: string): Promise<string> {
  const [version, latest] = await Promise.all([
    supabase.from("locations").select("calendar_version").eq("id", locationId).single(),
    supabase.from("appointments").select("updated_at").eq("location_id", locationId).order("updated_at", { ascending: false }).limit(1),
  ]);
  if (version.error) throw version.error;
  if (latest.error) throw latest.error;
  return `${version.data.calendar_version}:${latest.data[0]?.updated_at ?? ""}`;
}

// Blocks at a location (all of them: a location has a handful).
export async function loadBlocks(supabase: Supabase, locationId: string): Promise<TimeBlock[]> {
  const { data, error } = await supabase
    .from("time_blocks")
    .select("id, staff_id, kind, note, start_minute, end_minute, on_date, repeat_weekdays, starts_on, ends_on, event_id, time_block_skips(on_date)")
    .eq("location_id", locationId);
  if (error) throw error;
  return data.map((b) => ({
    id: b.id,
    staffId: b.staff_id,
    kind: b.kind,
    note: b.note,
    startMinute: b.start_minute,
    endMinute: b.end_minute,
    onDate: b.on_date,
    weekdays: b.repeat_weekdays,
    startsOn: b.starts_on,
    endsOn: b.ends_on,
    skips: b.time_block_skips.map((s) => s.on_date),
    eventId: b.event_id,
  }));
}

// Each day of each block between two local dates (inclusive).
export async function loadBlockOccurrences(supabase: Supabase, locationId: string, from: LocalDate, to: LocalDate): Promise<BlockOccurrence[]> {
  return (await loadBlocks(supabase, locationId)).flatMap((b) => occurrences(b, from, to));
}

export function blockedTimes(list: readonly BlockOccurrence[], timeZone: string): BlockedTime[] {
  return list.flatMap((o) => {
    const span = occurrenceSpan(o, timeZone);
    return span ? [{ blockId: o.blockId, date: o.date, staffId: o.staffId, kind: o.kind, repeating: o.repeating, ...span }] : [];
  });
}

// Stylists' own lengths for services (where set), by staff id.
export async function loadStaffTimings(supabase: Supabase, staffIds: string[]): Promise<Map<string, Map<string, ServiceTiming>>> {
  const timings = new Map<string, Map<string, ServiceTiming>>();
  if (!staffIds.length) return timings;
  const { data, error } = await supabase
    .from("staff_services")
    .select("staff_id, service_id, active_minutes, processing_minutes, finishing_minutes")
    .in("staff_id", staffIds)
    .not("active_minutes", "is", null);
  if (error) throw error;
  for (const t of data) {
    if (!timings.has(t.staff_id)) timings.set(t.staff_id, new Map());
    timings.get(t.staff_id)!.set(t.service_id, { activeMinutes: t.active_minutes!, processingMinutes: t.processing_minutes!, finishingMinutes: t.finishing_minutes! });
  }
  return timings;
}

// Which services each staff member offers, with their price for each (null
// means the menu price).
export async function loadOffers(supabase: Supabase, staffIds: string[]): Promise<Map<string, Map<string, number | null>>> {
  const offers = new Map<string, Map<string, number | null>>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("staff_services")
      .select("staff_id, service_id, price_cents")
      .in("staff_id", staffIds)
      .order("staff_id")
      .order("service_id")
      .range(offset, offset + 999);
    if (error) throw error;
    for (const o of data) {
      if (!offers.has(o.staff_id)) offers.set(o.staff_id, new Map());
      offers.get(o.staff_id)!.set(o.service_id, o.price_cents);
    }
    if (data.length < 1000) break;
  }
  return offers;
}
