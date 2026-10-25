// Booking a waitlist client into an opening, and booking a walk-in with the
// next free stylist. Both go through the booking rules (saveBooking) like
// any other booking.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { normalizePhone } from "@/lib/clients";
import { saveBooking, type SaveResult } from "@/lib/scheduling/book";
import { describeProblem } from "@/lib/scheduling/booking";
import { loadBookingContext } from "@/lib/scheduling/load";
import { itemsFor } from "@/lib/scheduling/series-book";
import { formatMinute, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { chainLines, walkInQueue } from "@/lib/scheduling/waitlist";

type Supabase = SupabaseClient<Database>;
type Location = { id: string; timezone: string };
export type BookOutcome = { ok: true; message: string; appointmentId: string } | { ok: false; message: string };

function failed(result: Exclude<SaveResult, { ok: true }>): string {
  if (result.error === "invalid") {
    const problem = result.problems.flat()[0];
    return problem ? `That time doesn't work any more: ${describeProblem(problem)}` : "That time doesn't work any more.";
  }
  if (result.error === "forbidden") return "Only the front desk, managers and owners can book.";
  if (result.error === "busy") return "Someone changed the calendar at the same moment. Try again.";
  return "Couldn't book that. Try again.";
}

async function staffName(supabase: Supabase, staffId: string): Promise<string> {
  const { data, error } = await supabase.from("staff").select("first_name").eq("id", staffId).single();
  if (error) throw error;
  return data.first_name;
}

export async function bookWaitlistEntry(supabase: Supabase, location: Location, entryId: string, staffId: string, date: LocalDate, startMinute: number): Promise<BookOutcome> {
  const { data: entry, error } = await supabase
    .from("waitlist_entries")
    .select("id, client_id, service_ids, notes, status, client:clients(first_name, last_name)")
    .eq("id", entryId)
    .maybeSingle();
  if (error) throw error;
  if (!entry || entry.status !== "waiting") return { ok: false, message: "That client is no longer on the waitlist." };
  const ctx = await loadBookingContext(supabase, location, date, date);
  const lines = chainLines(ctx, entry.service_ids, staffId, startMinute);
  const items = lines && itemsFor(lines, date, location.timezone);
  if (!items) return { ok: false, message: "One of those services isn't offered any more." };
  // Claimed first, so two people booking them at once make one visit.
  if (!(await claim(supabase, "waitlist_entries", entryId))) return { ok: false, message: "That client is no longer on the waitlist." };
  const saved = await saveBooking(supabase, location, { clientId: entry.client_id, notes: entry.notes, items }).catch(async (e) => {
    await release(supabase, "waitlist_entries", entryId);
    throw e;
  });
  if (!saved.ok) {
    await release(supabase, "waitlist_entries", entryId);
    return { ok: false, message: failed(saved) };
  }
  const { error: updateError } = await supabase.from("waitlist_entries").update({ appointment_id: saved.appointmentId }).eq("id", entryId);
  if (updateError) throw updateError;
  const first = entry.client.first_name;
  return {
    ok: true,
    appointmentId: saved.appointmentId,
    message: `Booked ${first} ${entry.client.last_name} with ${await staffName(supabase, staffId)} at ${formatMinute(startMinute)}. Let ${first} know.`.replace(/\s+/g, " "),
  };
}

export type WalkInRow = { id: string; name: string; phone: string | null; serviceId: string; arrivedAt: string; estimate: { staffId: string; start: number; wait: number } | null };

// The queue for today, in arrival order, each with the next free stylist
// after those ahead of them.
export async function walkInQueueFor(supabase: Supabase, location: Location, today: LocalDate, now: Date): Promise<WalkInRow[]> {
  const { data, error } = await supabase
    .from("walk_ins")
    .select("id, name, phone, service_id, arrived_at")
    .eq("location_id", location.id)
    .eq("status", "waiting")
    .gte("arrived_at", new Date(now.getTime() - 18 * 3_600_000).toISOString())
    .order("arrived_at");
  if (error) throw error;
  if (!data.length) return [];
  const ctx = await loadBookingContext(supabase, location, today, today);
  const local = toLocal(now, location.timezone);
  const estimates = walkInQueue(ctx, data.map((w) => ({ id: w.id, serviceId: w.service_id })), today, local.date === today ? local.minute : 0);
  return data.map((w, i) => {
    const e = estimates[i];
    return { id: w.id, name: w.name, phone: w.phone, serviceId: w.service_id, arrivedAt: w.arrived_at, estimate: e.staffId ? { staffId: e.staffId, start: e.start, wait: e.wait } : null };
  });
}

// Books a walk-in with their suggested stylist and time: an existing client
// with the same phone number, or a new client.
export async function bookWalkIn(supabase: Supabase, location: Location & { businessId: string }, walkInId: string, today: LocalDate, now: Date): Promise<BookOutcome> {
  const queue = await walkInQueueFor(supabase, location, today, now);
  const walkIn = queue.find((w) => w.id === walkInId);
  if (!walkIn) return { ok: false, message: "That walk-in isn't waiting any more." };
  if (!walkIn.estimate) return { ok: false, message: "No one who does that service is free today." };
  if (!(await claim(supabase, "walk_ins", walkInId))) return { ok: false, message: "That walk-in isn't waiting any more." };
  try {
    const outcome = await bookClaimedWalkIn(supabase, location, { ...walkIn, estimate: walkIn.estimate }, today);
    if (!outcome.ok) await release(supabase, "walk_ins", walkInId);
    return outcome;
  } catch (e) {
    await release(supabase, "walk_ins", walkInId);
    throw e;
  }
}

async function bookClaimedWalkIn(
  supabase: Supabase,
  location: Location & { businessId: string },
  walkIn: WalkInRow & { estimate: NonNullable<WalkInRow["estimate"]> },
  today: LocalDate,
): Promise<BookOutcome> {
  const walkInId = walkIn.id;

  const phone = walkIn.phone ? normalizePhone(walkIn.phone) : null;
  let clientId: string | null = null;
  if (phone) {
    const { data: found, error } = await supabase.from("clients").select("id").eq("phone", phone).limit(1);
    if (error) throw error;
    clientId = found[0]?.id ?? null;
  }
  if (!clientId) {
    const [first, ...rest] = walkIn.name.trim().split(/\s+/);
    const { data: created, error } = await supabase
      .from("clients")
      .insert({ business_id: location.businessId, first_name: first, last_name: rest.join(" "), phone })
      .select("id")
      .single();
    if (error?.code === "42501") return { ok: false, message: "Only the front desk, managers and owners can book." };
    if (error) throw error;
    clientId = created.id;
  }

  const ctx = await loadBookingContext(supabase, location, today, today);
  const lines = chainLines(ctx, [walkIn.serviceId], walkIn.estimate.staffId, walkIn.estimate.start);
  const items = lines && itemsFor(lines, today, location.timezone);
  if (!items) return { ok: false, message: "That service isn't offered any more." };
  const saved = await saveBooking(supabase, location, { clientId, notes: "Walk-in", items });
  if (!saved.ok) return { ok: false, message: failed(saved) };
  const { error } = await supabase.from("walk_ins").update({ appointment_id: saved.appointmentId, client_id: clientId }).eq("id", walkInId);
  if (error) throw error;
  return {
    ok: true,
    appointmentId: saved.appointmentId,
    message: `Booked ${walkIn.name} with ${await staffName(supabase, walkIn.estimate.staffId)} at ${formatMinute(walkIn.estimate.start)}.`,
  };
}

// Takes a waiting walk-in or waitlist entry for booking, if it's still
// waiting (only one of two at once gets it); release puts it back.
async function claim(supabase: Supabase, table: "walk_ins" | "waitlist_entries", id: string): Promise<boolean> {
  const { data, error } = await supabase.from(table).update({ status: "booked" }).eq("id", id).eq("status", "waiting").select("id");
  if (error) throw error;
  return data.length > 0;
}

async function release(supabase: Supabase, table: "walk_ins" | "waitlist_entries", id: string) {
  await supabase.from(table).update({ status: "waiting" }).eq("id", id).is("appointment_id", null);
}
