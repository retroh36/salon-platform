// The facts behind Denise's reply to a report or a cancellation (who's
// left on a stylist's book, whether their day is over, who's next), loaded
// for ./respond.ts to word. Server only.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { dayView } from "@/lib/scheduling/availability";
import { loadLocationSchedule, loadStaffSchedules, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { callOutReply, canceledReply, lateReply, type Found, type Reply } from "./respond";
import type { DeniseState } from "./types";

type Supabase = SupabaseClient<Database>;
type Where = { supabase: Supabase; location: { id: string; timezone: string }; today: LocalDate; now?: Date };

const WAITING = ["booked", "confirmed", "checked_in"];

// The conflict a report made, by its subject (see lib/scheduling/resolve.ts).
function found(state: DeniseState, subject: string): Found {
  const c = state.conflicts.find((x) => x.subject === `${state.date}:${subject}`);
  return c ? { options: c.options.length } : null;
}

async function firstName(supabase: Supabase, staffId: string) {
  const { data } = await supabase.from("staff").select("first_name").eq("id", staffId).single();
  return data?.first_name ?? "This stylist";
}

// A stylist's visits that day still holding time, in local minutes.
async function visitsOf(w: Where, staffId: string, date: LocalDate) {
  const tz = w.location.timezone;
  const { data, error } = await w.supabase
    .from("appointment_items")
    .select("appointment_id, starts_at, ends_at, finished_at, appointment:appointments!inner(status)")
    .eq("staff_id", staffId)
    .gte("starts_at", startOfLocalDay(date, tz).toISOString())
    .lt("starts_at", startOfLocalDay(addDays(date, 1), tz).toISOString())
    .in("appointment.status", WAITING)
    .order("starts_at");
  if (error) throw error;
  return data.map((i) => ({ appointmentId: i.appointment_id, start: toLocal(new Date(i.starts_at), tz).minute, end: toLocal(new Date(i.ends_at), tz).minute, finished: i.finished_at !== null }));
}

export async function replyToCallOut(w: Where, staffId: string, date: LocalDate, disruptionId: string, state: DeniseState): Promise<Reply> {
  const isToday = date === w.today;
  const nowMinute = isToday ? toLocal(w.now ?? new Date(), w.location.timezone).minute : 0;
  const [stylist, visits, location, schedules] = await Promise.all([
    firstName(w.supabase, staffId),
    visitsOf(w, staffId, date),
    loadLocationSchedule(w.supabase, w.location),
    loadStaffSchedules(w.supabase, [staffId], date, date),
  ]);
  const left = new Set(visits.filter((v) => !v.finished && v.end > nowMinute).map((v) => v.appointmentId));
  // Their hours that day, before being marked out.
  const schedule = schedules.get(staffId);
  const hours = schedule ? dayView({ ...schedule, timeOff: [] }, location, date).available : [];
  return callOutReply({ stylist, isToday, clients: left.size, dayOver: !hours.some((h) => h.end > nowMinute), found: found(state, `call_out:${disruptionId}`) });
}

export async function replyToLate(w: Where, itemId: string, minutes: number, date: LocalDate, disruptionId: string, state: DeniseState): Promise<Reply> {
  const { data: item, error } = await w.supabase
    .from("appointment_items")
    .select("staff_id, starts_at, ends_at, appointment_id, appointment:appointments!inner(status, client:clients(first_name))")
    .eq("id", itemId)
    .single();
  if (error) throw error;
  const checkedIn = item.appointment.status === "checked_in";
  const [stylist, visits] = await Promise.all([firstName(w.supabase, item.staff_id), visitsOf(w, item.staff_id, date)]);
  const start = toLocal(new Date(item.starts_at), w.location.timezone).minute;
  const end = toLocal(new Date(item.ends_at), w.location.timezone).minute;
  const next = visits.find((v) => v.appointmentId !== item.appointment_id && v.start >= start);
  const nowMinute = date === w.today ? toLocal(w.now ?? new Date(), w.location.timezone).minute : -1;
  return lateReply({
    start,
    alreadyPast: nowMinute >= 0 && (checkedIn ? end : start) + minutes <= nowMinute,
    stylist,
    client: item.appointment.client?.first_name ?? "The client",
    checkedIn,
    minutes,
    isToday: date === w.today,
    nextStart: next?.start ?? null,
    found: found(state, `${checkedIn ? "overrun" : "late"}:${disruptionId}`),
  });
}

export async function replyToCancel(w: Where, appointmentId: string, state: DeniseState): Promise<Reply | null> {
  const tz = w.location.timezone;
  const { data, error } = await w.supabase.from("appointment_items").select("staff_id, starts_at, ends_at").eq("appointment_id", appointmentId).order("starts_at");
  if (error) throw error;
  if (!data.length) return null;
  const first = data[0];
  const span = { start: toLocal(new Date(first.starts_at), tz).minute, end: toLocal(new Date(data.at(-1)!.ends_at), tz).minute };
  const mine = data.filter((i) => i.staff_id === first.staff_id);
  const end = toLocal(new Date(mine.at(-1)!.ends_at), tz).minute;
  const matches = state.openings
    .filter((o) => o.staffId === first.staff_id && o.startMinute < end && o.endMinute > span.start)
    .reduce((n, o) => n + o.matches.length, 0);
  return canceledReply({ stylist: await firstName(w.supabase, first.staff_id), start: span.start, end, waitlistMatches: matches });
}
