import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { FREE_STATUSES, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import { blackoutsFor, othersOff, visitsDuring, type Blackout, type BookedVisit, type OtherOff, type Span } from "@/lib/time-off-requests";

type Supabase = SupabaseClient<Database>;

export type TimeOffRequest = Span & {
  id: string;
  staffId: string;
  name: string;
  firstName: string;
  reason: string;
  note: string | null;
  status: "requested" | "approved" | "declined";
  shortNotice: boolean;
  blackouts: Blackout[];
  askedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  declineReason: string | null;
  // Clients still booked with them then (first names).
  visits: BookedVisit[];
  othersOff: OtherOff[];
};

export type RequestsInbox = {
  pending: TimeOffRequest[];
  // Decided in the last 30 days, newest first.
  decided: TimeOffRequest[];
  noticeDays: number;
};

const FIELDS = "id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status, short_notice, in_blackout, decline_reason, created_at, decided_at, decided_by";

// Requests at a location: those waiting, and those decided lately, each
// with the clients booked then and who else is off.
export async function loadRequestsInbox(supabase: Supabase, location: { id: string; timezone: string; business_id?: string }, today: LocalDate): Promise<RequestsInbox> {
  const tz = location.timezone;
  const [team, pending, decided, blackouts, business] = await Promise.all([
    supabase.from("staff").select("id, first_name, last_name, location_id").eq("location_id", location.id),
    supabase.from("staff_time_off").select(FIELDS).eq("status", "requested").gte("ends_on", today).order("starts_on"),
    supabase
      .from("staff_time_off")
      .select(FIELDS)
      .neq("status", "requested")
      .not("decided_at", "is", null)
      .gte("decided_at", startOfLocalDay(addDays(today, -30), tz).toISOString())
      .order("decided_at", { ascending: false })
      .limit(30),
    supabase.from("time_off_blackouts").select("starts_on, ends_on, label").gte("ends_on", today).order("starts_on"),
    supabase.from("businesses").select("time_off_notice_days").single(),
  ]);
  for (const r of [team, pending, decided, blackouts, business]) if (r.error) throw r.error;
  const people = new Map(team.data!.map((s) => [s.id, s]));
  const here = (r: { staff_id: string }) => people.has(r.staff_id);
  const rows = [...pending.data!.filter(here), ...decided.data!.filter(here)];
  const blackoutList: Blackout[] = blackouts.data!.map((b) => ({ startsOn: b.starts_on, endsOn: b.ends_on, label: b.label }));

  // The clients booked with each of them, and others' time off, across every request.
  const from = rows.reduce((m, r) => (r.starts_on < m ? r.starts_on : m), addDays(today, 366));
  const to = rows.reduce((m, r) => (r.ends_on > m ? r.ends_on : m), today);
  const staffIds = [...new Set(rows.map((r) => r.staff_id))];
  const [items, off] = rows.length
    ? await Promise.all([
        supabase
          .from("appointment_items")
          .select("staff_id, starts_at, active_minutes, processing_minutes, finishing_minutes, appointment:appointments!inner(id, status, client:clients(first_name))")
          .in("staff_id", staffIds)
          .gte("starts_at", startOfLocalDay(from, tz).toISOString())
          .lt("starts_at", startOfLocalDay(addDays(to, 1), tz).toISOString())
          .not("appointment.status", "in", `(${FREE_STATUSES.join(",")})`),
        supabase.from("staff_time_off").select("staff_id, starts_on, ends_on, start_minute, end_minute, status").in("status", ["approved", "requested"]).lte("starts_on", to).gte("ends_on", from),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (items.error) throw items.error;
  if (off.error) throw off.error;

  // One visit per appointment per stylist, from its first to its last minute with them.
  const visitsOf = new Map<string, Map<string, BookedVisit>>();
  for (const i of items.data ?? []) {
    const start = toLocal(new Date(i.starts_at), tz);
    const end = start.minute + i.active_minutes + i.processing_minutes + i.finishing_minutes;
    const mine = visitsOf.get(i.staff_id) ?? new Map<string, BookedVisit>();
    const v = mine.get(i.appointment.id);
    if (v) {
      v.start = Math.min(v.start, start.minute);
      v.end = Math.max(v.end, end);
    } else {
      mine.set(i.appointment.id, { appointmentId: i.appointment.id, date: start.date, start: start.minute, end, client: i.appointment.client?.first_name ?? "Walk-in" });
    }
    visitsOf.set(i.staff_id, mine);
  }
  const others: OtherOff[] = (off.data ?? [])
    .filter((o) => people.has(o.staff_id))
    .map((o) => ({
      staffId: o.staff_id,
      name: people.get(o.staff_id)!.first_name,
      status: o.status as "approved" | "requested",
      startsOn: o.starts_on,
      endsOn: o.ends_on,
      startMinute: o.start_minute,
      endMinute: o.end_minute,
    }));

  const request = (r: (typeof rows)[number]): TimeOffRequest => {
    const span: Span = { startsOn: r.starts_on, endsOn: r.ends_on, startMinute: r.start_minute, endMinute: r.end_minute };
    const person = people.get(r.staff_id)!;
    return {
      ...span,
      id: r.id,
      staffId: r.staff_id,
      name: fullName(person),
      firstName: person.first_name,
      reason: r.reason,
      note: r.note,
      status: r.status,
      shortNotice: r.short_notice,
      blackouts: r.in_blackout ? blackoutsFor(span, blackoutList) : [],
      askedAt: r.created_at,
      decidedAt: r.decided_at,
      decidedBy: r.decided_by ? (people.has(r.decided_by) ? fullName(people.get(r.decided_by)!) : null) : null,
      declineReason: r.decline_reason,
      visits: r.status === "declined" ? [] : visitsDuring(span, [...(visitsOf.get(r.staff_id)?.values() ?? [])]).filter((v) => v.date >= today),
      othersOff: othersOff({ ...span, staffId: r.staff_id }, others),
    };
  };

  return {
    pending: pending.data!.filter(here).map(request),
    decided: decided.data!.filter(here).map(request),
    noticeDays: business.data!.time_off_notice_days,
  };
}

// How many requests are waiting at a location (for the tab's count).
export async function countPendingRequests(supabase: Supabase, location: { id: string }, today: LocalDate): Promise<number> {
  const { count, error } = await supabase
    .from("staff_time_off")
    .select("id, staff:staff!staff_time_off_staff_id_business_id_fkey!inner(location_id)", { count: "exact", head: true })
    .eq("status", "requested")
    .gte("ends_on", today)
    .eq("staff.location_id", location.id);
  if (error) throw error;
  return count ?? 0;
}
