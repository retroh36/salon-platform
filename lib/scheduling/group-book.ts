// Booking, moving and canceling group bookings. Each guest's visit is
// checked through ./book.ts like any other, and the group is saved as one
// change: booking it or moving it saves every guest or no one.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ACTION_STATUS, type AppointmentAction } from "../appointments.ts";
import { changeStatus, saveBookings, type StatusResult } from "./book.ts";
import { checkMoves, type BookingProblem } from "./booking.ts";
import { checkGroup } from "./groups.ts";
import { loadBookingContext } from "./load.ts";
import { itemsFor } from "./series-book.ts";
import type { VisitLine } from "./series.ts";
import { daysBetween, shiftStart, toLocal, type LocalDate } from "./time.ts";

type Supabase = SupabaseClient<Database>;
type Location = { id: string; timezone: string };

export type GuestInput = { clientId: string | null; lines: VisitLine[] };
export type GroupResult =
  | { ok: true; groupId: string; appointmentIds: string[] }
  | { ok: false; error: "invalid"; problems: BookingProblem[][][] }
  // Someone took a slot between the check and the save: no one was booked.
  | { ok: false; error: "forbidden" | "taken" };

// Books every guest, or none if they don't all fit together.
export async function bookGroup(
  supabase: Supabase,
  location: Location & { businessId: string },
  input: { label: string; date: LocalDate; notes: string | null; guests: GuestInput[] },
): Promise<GroupResult> {
  const ctx = await loadBookingContext(supabase, location, input.date, input.date);
  const check = checkGroup(ctx, input.guests.map((g) => g.lines), input.date);
  if (!check.ok) return { ok: false, error: "invalid", problems: check.problems };

  const saved = await saveBookings(
    supabase,
    location,
    input.guests.map((g) => ({ clientId: g.clientId, notes: input.notes, items: itemsFor(g.lines, input.date, location.timezone)! })),
    { group: { label: input.label.trim() } },
  );
  if (saved.ok) return { ok: true, groupId: saved.groupId!, appointmentIds: saved.appointmentIds };
  if (saved.error === "invalid") return { ok: false, error: "invalid", problems: saved.problems };
  return { ok: false, error: saved.error === "forbidden" ? "forbidden" : "taken" };
}

type Member = {
  appointmentId: string;
  clientId: string | null;
  notes: string | null;
  status: Database["public"]["Enums"]["appointment_status"];
  items: { id: string; serviceId: string; staffId: string; resourceId: string | null; start: Date }[];
};

async function membersOf(supabase: Supabase, appointmentId: string): Promise<{ groupId: string; members: Member[] } | null> {
  const { data: a, error } = await supabase.from("appointments").select("group_id").eq("id", appointmentId).maybeSingle();
  if (error) throw error;
  if (!a?.group_id) return null;
  const { data, error: membersError } = await supabase
    .from("appointments")
    .select("id, client_id, notes, status, appointment_items(id, service_id, staff_id, resource_id, starts_at)")
    .eq("group_id", a.group_id);
  if (membersError) throw membersError;
  return {
    groupId: a.group_id,
    members: data.map((m) => ({
      appointmentId: m.id,
      clientId: m.client_id,
      notes: m.notes,
      status: m.status,
      items: m.appointment_items.map((i) => ({ id: i.id, serviceId: i.service_id, staffId: i.staff_id, resourceId: i.resource_id, start: new Date(i.starts_at) })),
    })),
  };
}

const movable = (m: Member) => m.status === "booked" || m.status === "confirmed";

// "taken": the calendar changed at the same moment; no one was moved.
export type GroupMoveResult = { ok: true; moved: number } | { ok: false; error: "not_found" | "invalid" | "taken"; problems?: BookingProblem[][] };

// Moves the whole group by the same amount as the dragged service (which
// can also change stylist), if every visit still fits; otherwise nothing.
export async function moveGroupItem(supabase: Supabase, location: Location, move: { itemId: string; staffId: string; start: Date }): Promise<GroupMoveResult> {
  const { data: item, error } = await supabase.from("appointment_items").select("appointment_id, starts_at").eq("id", move.itemId).maybeSingle();
  if (error) throw error;
  if (!item) return { ok: false, error: "not_found" };
  const group = await membersOf(supabase, item.appointment_id);
  if (!group) return { ok: false, error: "not_found" };
  // By the same local days and minutes (another day keeps its wall-clock
  // times across daylight saving).
  const from = toLocal(new Date(item.starts_at), location.timezone);
  const to = toLocal(move.start, location.timezone);
  const days = daysBetween(from.date, to.date);
  const minutes = to.minute - from.minute;
  const members = group.members.filter(movable);
  const placed: { itemId: string; appointmentId: string; staffId: string; resourceId: string | null; start: Date }[] = [];
  for (const m of members) {
    for (const i of m.items) {
      const start = shiftStart(i.start, location.timezone, days, minutes);
      if (!start) return { ok: false, error: "invalid", problems: [[{ code: "invalid_start" }]] };
      placed.push({ itemId: i.id, appointmentId: m.appointmentId, staffId: i.id === move.itemId ? move.staffId : i.staffId, resourceId: i.resourceId, start });
    }
  }

  // The days they're on and the days they're going to (the rules check the
  // moves against both).
  const dates = [...placed.map((p) => p.start), ...members.flatMap((m) => m.items.map((i) => i.start))].map((d) => toLocal(d, location.timezone).date).sort();
  const ctx = await loadBookingContext(supabase, location, dates[0], dates.at(-1)!);
  const check = checkMoves(ctx, placed);
  if (!check.valid) return { ok: false, error: "invalid", problems: check.problems };

  const saved = await saveBookings(
    supabase,
    location,
    members.map((m) => ({
      appointmentId: m.appointmentId,
      clientId: m.clientId,
      notes: m.notes,
      items: placed
        .filter((p) => p.appointmentId === m.appointmentId)
        .map((p) => ({ id: p.itemId, serviceId: m.items.find((i) => i.id === p.itemId)!.serviceId, staffId: p.staffId, start: p.start, resource: p.resourceId ? { kind: "exact" as const, id: p.resourceId } : { kind: "none" as const } })),
    })),
  );
  if (saved.ok) return { ok: true, moved: members.length };
  if (saved.error === "invalid") return { ok: false, error: "invalid", problems: saved.problems.flat() };
  return { ok: false, error: saved.error === "not_found" ? "not_found" : "taken" };
}

// Cancels (or another status change) every visit in the group that still can be.
export async function changeGroupStatus(supabase: Supabase, appointmentId: string, action: AppointmentAction, reason: string | null): Promise<{ appointmentId: string; result: StatusResult }[]> {
  const group = await membersOf(supabase, appointmentId);
  if (!group) return [{ appointmentId, result: await changeStatus(supabase, appointmentId, action, reason) }];
  const out: { appointmentId: string; result: StatusResult }[] = [];
  for (const m of group.members.filter((x) => x.status !== ACTION_STATUS[action] && movable(x))) {
    out.push({ appointmentId: m.appointmentId, result: await changeStatus(supabase, m.appointmentId, action, reason) });
  }
  return out;
}
