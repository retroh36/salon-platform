import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { shiftsOn } from "@/lib/payroll";
import { loadStaffSchedules, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, formatMinute, todayIn, type LocalDate } from "@/lib/scheduling/time";
import { clockReminders, reminderText, type ClockEntry, type Reminder } from "@/lib/time-clock";

type Supabase = SupabaseClient<Database>;

type Row = { id: string; staff_id: string; clock_in: string; clock_out: string | null; edited: boolean; missed_out: boolean; source: string };

const toEntry = (r: Row): ClockEntry & { source: string } => ({
  id: r.id,
  staffId: r.staff_id,
  clockIn: new Date(r.clock_in),
  clockOut: r.clock_out ? new Date(r.clock_out) : null,
  edited: r.edited,
  missedOut: r.missed_out,
  source: r.source,
});

export type TimeClockEntry = ReturnType<typeof toEntry>;

// Punches clocked in from `from` to `to` (local days) at a location, plus
// any still open from before (a missed clock-out). RLS decides whose:
// yourself, or the team's with `team` or `payroll`.
export async function loadEntries(supabase: Supabase, location: { id: string; timezone: string }, from: LocalDate, to: LocalDate, staffId?: string): Promise<TimeClockEntry[]> {
  let range = supabase
    .from("time_clock_entries")
    .select("id, staff_id, clock_in, clock_out, edited, missed_out, source")
    .eq("location_id", location.id)
    .gte("clock_in", startOfLocalDay(addDays(from, -1), location.timezone).toISOString())
    .lt("clock_in", startOfLocalDay(addDays(to, 1), location.timezone).toISOString())
    .order("clock_in")
    .limit(5000);
  let open = supabase.from("time_clock_entries").select("id, staff_id, clock_in, clock_out, edited, missed_out, source").eq("location_id", location.id).is("clock_out", null);
  if (staffId) {
    range = range.eq("staff_id", staffId);
    open = open.eq("staff_id", staffId);
  }
  const [a, b] = await Promise.all([range, open]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  const byId = new Map([...a.data, ...b.data].map((r) => [r.id, toEntry(r)]));
  return [...byId.values()].sort((x, y) => x.clockIn.getTime() - y.clockIn.getTime());
}

// Whether the salon uses the time clock.
export async function clockOn(supabase: Supabase, businessId: string): Promise<boolean> {
  const { data, error } = await supabase.from("businesses").select("time_clock").eq("id", businessId).single();
  if (error) throw error;
  return data.time_clock;
}

// Everyone at a location who should be clocked in or out now (see
// clockReminders), with their first names.
export async function dueReminders(supabase: Supabase, location: { id: string; timezone: string }, now: Date): Promise<(Reminder & { firstName: string })[]> {
  const today = todayIn(location.timezone);
  const { data: staff, error } = await supabase.from("staff").select("id, first_name, role").eq("location_id", location.id).eq("is_active", true).neq("role", "bookkeeper");
  if (error) throw error;
  if (!staff.length) return [];
  const [schedules, entries] = await Promise.all([loadStaffSchedules(supabase, staff.map((s) => s.id), today, today), loadEntries(supabase, location, today, today)]);
  const people = staff.map((s) => ({ staffId: s.id, shifts: shiftsOn(schedules.get(s.id)!, today) }));
  const names = new Map(staff.map((s) => [s.id, s.first_name]));
  return clockReminders(people, entries, location.timezone, now).map((r) => ({ ...r, firstName: names.get(r.staffId) ?? "" }));
}

// The reminder job: for every salon using the time clock, each reminder
// due now, recorded once (record_clock_reminder) as an app notice. Service
// role. Returns how many were new.
export async function runClockReminders(admin: Supabase, now = new Date()): Promise<number> {
  const { data, error } = await admin.from("businesses").select("id, locations(id, timezone)").eq("time_clock", true);
  if (error) throw error;
  let sent = 0;
  for (const b of data) {
    for (const l of b.locations) {
      for (const r of await dueReminders(admin, l, now)) {
        const { data: fresh, error: e } = await admin.rpc("record_clock_reminder", {
          p_staff_id: r.staffId,
          p_on_date: todayIn(l.timezone),
          p_kind: r.kind,
          p_shift_start: r.shiftStart,
          p_body: reminderText(r, formatMinute),
        });
        if (e) throw e;
        if (fresh) sent += 1;
      }
    }
  }
  return sent;
}
