import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Interval } from "@/lib/scheduling/intervals";
import { hoursOn, type StaffSchedule } from "@/lib/scheduling/availability";
import { loadStaffSchedules } from "@/lib/scheduling/load";
import { addDays, datesBetween, type LocalDate } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import { swapPartners, type SwapDay, type SwapStatus } from "@/lib/shift-swaps";

type Supabase = SupabaseClient<Database>;

// How far ahead someone can offer a day.
export const SWAP_WEEKS = 6;

export type ShiftSwap = {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  giveDate: LocalDate;
  giveShifts: Interval[];
  takeDate: LocalDate | null;
  takeShifts: Interval[] | null;
  note: string | null;
  status: SwapStatus;
  declineReason: string | null;
  createdAt: string;
};

export type SwapPerson = { id: string; name: string; firstName: string; days: Record<LocalDate, SwapDay> };

const FIELDS = "id, from_staff_id, to_staff_id, give_date, give_shifts, take_date, take_shifts, note, status, decline_reason, created_at";

const shifts = (j: unknown): Interval[] => (Array.isArray(j) ? j.map((s) => ({ start: Number(s.start), end: Number(s.end) })) : []);

type SwapRow = Pick<Database["public"]["Tables"]["shift_swaps"]["Row"], "id" | "from_staff_id" | "to_staff_id" | "give_date" | "give_shifts" | "take_date" | "take_shifts" | "note" | "status" | "decline_reason" | "created_at">;

function swapOf(row: SwapRow, names: Map<string, { first_name: string; last_name: string }>): ShiftSwap {
  const name = (id: string) => (names.has(id) ? fullName(names.get(id)!) : "Someone");
  return {
    id: row.id,
    fromId: row.from_staff_id,
    fromName: name(row.from_staff_id),
    toId: row.to_staff_id,
    toName: name(row.to_staff_id),
    giveDate: row.give_date,
    giveShifts: shifts(row.give_shifts),
    takeDate: row.take_date,
    takeShifts: row.take_date ? shifts(row.take_shifts) : null,
    note: row.note,
    status: row.status,
    declineReason: row.decline_reason,
    createdAt: row.created_at,
  };
}

function days(schedule: StaffSchedule, from: LocalDate, to: LocalDate): Record<LocalDate, SwapDay> {
  return Object.fromEntries(
    datesBetween(from, to).map((date) => [
      date,
      {
        hours: hoursOn(schedule, date),
        timeOff: schedule.timeOff
          .filter((t) => t.status === "approved" && t.startsOn <= date && t.endsOn >= date)
          .map((t) => ({ startMinute: t.startMinute ?? null, endMinute: t.endMinute ?? null })),
      },
    ]),
  );
}

// Someone's swaps page: their days ahead, coworkers in the same role with
// theirs, and the swaps they asked for or were asked.
export async function loadMySwaps(supabase: Supabase, me: { id: string; role: string; location: { id: string } }, today: LocalDate) {
  const to = addDays(today, SWAP_WEEKS * 7);
  const [team, rows] = await Promise.all([
    supabase.from("staff").select("id, first_name, last_name, role, is_active").eq("location_id", me.location.id),
    supabase.from("shift_swaps").select(FIELDS).or(`from_staff_id.eq.${me.id},to_staff_id.eq.${me.id}`).order("give_date"),
  ]);
  if (team.error) throw team.error;
  if (rows.error) throw rows.error;
  const names = new Map(team.data.map((s) => [s.id, s]));
  const partners = swapPartners(me, team.data.map((s) => ({ ...s, isActive: s.is_active })));
  const schedules = await loadStaffSchedules(supabase, [me.id, ...partners.map((p) => p.id)], today, to);
  const person = (id: string): SwapPerson => ({ id, name: fullName(names.get(id)!), firstName: names.get(id)!.first_name, days: days(schedules.get(id)!, today, to) });
  const swaps = rows.data.map((r) => swapOf(r, names));
  return {
    me: person(me.id),
    partners: partners.map((p) => person(p.id)),
    // Asked of me and waiting for my answer.
    incoming: swaps.filter((s) => s.toId === me.id && s.status === "asked"),
    // Everything else I'm in, from the last two weeks on.
    mine: swaps.filter((s) => !(s.toId === me.id && s.status === "asked") && s.giveDate >= addDays(today, -14)),
  };
}

// Swaps both people have agreed to, waiting for an owner or manager.
export async function loadSwapsToApprove(supabase: Supabase, location: { id: string }, today: LocalDate): Promise<ShiftSwap[]> {
  const [team, rows] = await Promise.all([
    supabase.from("staff").select("id, first_name, last_name").eq("location_id", location.id),
    supabase.from("shift_swaps").select(FIELDS).eq("location_id", location.id).eq("status", "accepted").gte("give_date", today).order("give_date"),
  ]);
  if (team.error) throw team.error;
  if (rows.error) throw rows.error;
  const names = new Map(team.data.map((s) => [s.id, s]));
  return rows.data.map((r) => swapOf(r, names));
}
