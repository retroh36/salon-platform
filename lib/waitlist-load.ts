// Loads the waitlist and the time freed up on a day (cancellations,
// no-shows, and where an applied Denise fix moved visits from), and turns
// them into the openings Denise offers in her panel.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatDuration } from "@/lib/duration";
import { proposalFromJson } from "@/lib/scheduling/ai-actions";
import type { BookingContext } from "@/lib/scheduling/booking";
import { FREE_STATUSES, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, formatMinute, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { matchOpening, openingAround, type FreedSlot, type WaitlistEntry, type WindowName } from "@/lib/scheduling/waitlist";
import type { WaitlistOpening } from "@/lib/denise/types";
import { fullName } from "@/lib/staff";

type Supabase = SupabaseClient<Database>;

export type WaitlistRow = WaitlistEntry & { clientName: string; phone: string | null; notes: string | null; services: string; stylists: string };

// Everyone still waiting whose dates reach `from` or later.
export async function loadWaitlist(supabase: Supabase, locationId: string, from: LocalDate): Promise<WaitlistRow[]> {
  const [{ data, error }, { data: services, error: serviceError }, { data: staff, error: staffError }, { data: priority }] = await Promise.all([
    supabase
      .from("waitlist_entries")
      .select("id, client_id, service_ids, staff_ids, from_date, to_date, windows, notes, created_at, client:clients(first_name, last_name, phone)")
      .eq("location_id", locationId)
      .eq("status", "waiting")
      .gte("to_date", from)
      .order("created_at"),
    supabase.from("services").select("id, name"),
    supabase.from("staff").select("id, first_name"),
    // Clients in a rewards tier with priority booking (none when the program's off).
    supabase.rpc("waitlist_priority_clients", { p_location_id: locationId }),
  ]);
  const first = new Set(priority ?? []);
  if (error) throw error;
  if (serviceError) throw serviceError;
  if (staffError) throw staffError;
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const staffName = new Map(staff.map((s) => [s.id, s.first_name]));
  return data.map((e) => ({
    id: e.id,
    clientId: e.client_id,
    serviceIds: e.service_ids,
    staffIds: e.staff_ids,
    fromDate: e.from_date,
    toDate: e.to_date,
    windows: e.windows as WindowName[],
    createdAt: new Date(e.created_at),
    priority: first.has(e.client_id),
    clientName: fullName(e.client),
    phone: e.client.phone,
    notes: e.notes,
    services: e.service_ids.map((id) => serviceName.get(id) ?? "A service").join(" + "),
    stylists: e.staff_ids.length ? e.staff_ids.map((id) => staffName.get(id) ?? "a stylist").join(" or ") : "Any stylist",
  }));
}

type Freed = { staffId: string; start: number; end: number };

// Time freed on a day: canceled and no-show visits, and the places applied
// Denise fixes moved visits from.
export async function freedOn(supabase: Supabase, locationId: string, date: LocalDate, timeZone: string): Promise<Freed[]> {
  const dayStart = startOfLocalDay(date, timeZone);
  const dayEnd = startOfLocalDay(addDays(date, 1), timeZone);
  const [{ data: items, error }, { data: fixes, error: fixError }] = await Promise.all([
    supabase
      .from("appointment_items")
      .select("staff_id, starts_at, ends_at, appointment:appointments!inner(status, location_id)")
      .eq("appointment.location_id", locationId)
      .in("appointment.status", [...FREE_STATUSES])
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString()),
    supabase
      .from("ai_actions")
      .select("proposal")
      .eq("location_id", locationId)
      .eq("status", "approved")
      .gte("decided_at", new Date(dayStart.getTime() - 30 * 86_400_000).toISOString()),
  ]);
  if (error) throw error;
  if (fixError) throw fixError;
  const local = (iso: string | Date) => toLocal(new Date(iso), timeZone).minute;
  const freed: Freed[] = items.map((i) => ({ staffId: i.staff_id, start: local(i.starts_at), end: local(i.ends_at) }));
  for (const f of fixes) {
    for (const c of proposalFromJson(f.proposal).changes) {
      if (toLocal(c.from.start, timeZone).date !== date) continue;
      // Where it started is enough to find the gap it left.
      freed.push({ staffId: c.from.staffId, start: local(c.from.start), end: local(c.from.start) + 5 });
    }
  }
  return freed;
}


// Openings on a day with the waitlist clients who'd fit them, best first.
export function waitlistOpenings(
  ctx: BookingContext,
  date: LocalDate,
  freed: readonly Freed[],
  entries: readonly WaitlistRow[],
  staffNames: ReadonlyMap<string, string>,
  notBefore: number,
): WaitlistOpening[] {
  const seen = new Set<string>();
  const out: WaitlistOpening[] = [];
  for (const f of freed) {
    const opening: FreedSlot | null = openingAround(ctx, f.staffId, date, { start: f.start, end: f.end }, notBefore);
    if (!opening) continue;
    const key = `${date}:${opening.staffId}:${opening.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const matches = matchOpening(ctx, opening, entries);
    if (!matches.length) continue;
    const row = new Map(entries.map((e) => [e.id, e]));
    const name = staffNames.get(opening.staffId) ?? "a stylist";
    const people = matches.length === 1 ? "1 person" : `${matches.length} people`;
    out.push({
      key,
      staffId: opening.staffId,
      staffName: name,
      startMinute: opening.start,
      endMinute: opening.end,
      headline: `A ${formatDuration(opening.end - opening.start)} opening with ${name} at ${formatMinute(opening.start)} fits ${people} on your waitlist.`,
      matches: matches.map((m) => ({
        entryId: m.entryId,
        clientName: row.get(m.entryId)!.clientName,
        services: row.get(m.entryId)!.services,
        startMinute: m.start,
        endMinute: m.end,
        preferred: m.preferred,
        waitingSince: row.get(m.entryId)!.createdAt.toISOString(),
      })),
    });
  }
  return out.sort((a, b) => a.startMinute - b.startMinute);
}
