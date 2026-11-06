// Notices when staff move visits (editing them, dragging them, or moving
// them to another day), like Denise's fixes: a snapshot of each visit's
// first service before the change, then, once it's saved, a notice to each
// stylist involved for every visit whose day, time or stylist changed
// (lib/notifications.ts, fixed templates), recorded through
// record_visit_notices_for_user. Never to the client: the visits with a
// client that moved are handed back, and the calendar asks staff whether to
// tell them (app/calendar/move-prompt.tsx); only Send there messages them.
// A notice that can't be recorded never undoes the move; it's logged.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { moveNotices } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { toLocal, todayIn, type LocalDate } from "@/lib/scheduling/time";

type Supabase = SupabaseClient<Database>;

type First = { date: LocalDate; minute: number; staffId: string; staffFirstName: string; service: string };
type Visit = { client: { id: string; firstName: string; fullName: string } | null; first: First | null };
export type Snapshot = Map<string, Visit>;

async function load(supabase: Supabase, ids: readonly string[], timeZone: string): Promise<Snapshot> {
  const out: Snapshot = new Map();
  if (!ids.length) return out;
  const { data, error } = await supabase
    .from("appointments")
    .select("id, client:clients(id, first_name, last_name), appointment_items(starts_at, staff_id, staff:staff(first_name), service:services(name))")
    .in("id", [...new Set(ids)]);
  if (error) throw error;
  for (const a of data) {
    const item = [...a.appointment_items].sort((x, y) => x.starts_at.localeCompare(y.starts_at))[0];
    const when = item ? toLocal(new Date(item.starts_at), timeZone) : null;
    out.set(a.id, {
      client: a.client ? { id: a.client.id, firstName: a.client.first_name, fullName: `${a.client.first_name} ${a.client.last_name}`.trim() } : null,
      first: item && when ? { date: when.date, minute: when.minute, staffId: item.staff_id, staffFirstName: item.staff?.first_name ?? "your stylist", service: item.service?.name ?? "visit" } : null,
    });
  }
  return out;
}

// After the change: a notice to the stylists for each visit that moved.
// Returns the visits with a client whose day, time or stylist changed.
async function recordMoveNotices(supabase: Supabase, location: { timezone: string }, before: Snapshot): Promise<string[]> {
  const moved: string[] = [];
  try {
    const after = await load(supabase, [...before.keys()], location.timezone);
    const today = todayIn(location.timezone);
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return moved;
    const server = createAdminClient();
    for (const [appointmentId, was] of before) {
      const now = after.get(appointmentId);
      if (!was.first || !now?.first) continue;
      const notices = moveNotices({
        appointmentId,
        client: now.client,
        service: now.first.service,
        today,
        from: was.first,
        to: now.first,
      });
      if (!notices.length) continue;
      if (now.client) moved.push(appointmentId);
      // Recorded by the server, as the person who moved it, so nobody can
      // send notice text of their own in.
      const { error } = await server.rpc("record_visit_notices_for_user", {
        p_user_id: user.id,
        p_appointment_id: appointmentId,
        p_notices: notices.map((n) => ({ template: n.template, body: n.body, client_id: null, staff_id: n.staffId })),
      });
      if (error) throw error;
    }
  } catch (error) {
    console.error("Couldn't record move notices:", error instanceof Error ? error.message : error);
  }
  return moved;
}

// The visits a change to this one can move: it, and the rest of its series
// or group still to come.
async function relatedVisits(supabase: Supabase, appointmentId: string): Promise<string[]> {
  const { data: a } = await supabase.from("appointments").select("id, series_id, group_id").eq("id", appointmentId).maybeSingle();
  if (!a) return [];
  if (!a.series_id && !a.group_id) return [a.id];
  const column = a.series_id ? "series_id" : "group_id";
  const { data } = await supabase.from("appointments").select("id").eq(column, (a.series_id ?? a.group_id)!).in("status", ["booked", "confirmed"]);
  return [...new Set([a.id, ...(data ?? []).map((r) => r.id)])];
}

// The clients' visits a staff change moved, for the calendar to ask about
// (`at`: when, so a message sent since shows as sent).
// runningBehind: one of Denise's fixes absorbed a delay (the client still
// comes at their time and starts a little later), so the message to check
// is "We're running about 15 minutes behind", worked out from that fix
// (its AI action id), not "Your visit has moved".
export type Moved = { appointmentIds: string[]; at: string; runningBehind?: string };

// Makes a change staff asked for, then tells the stylists about every visit
// whose day, time or stylist it changed, and hands back the clients' ones.
export async function withMoveNotices<T>(supabase: Supabase, location: { timezone: string }, appointmentId: string | null, change: () => Promise<T>): Promise<{ result: T; moved: Moved | null }> {
  if (!appointmentId) return { result: await change(), moved: null };
  const at = new Date().toISOString();
  const before = await load(supabase, await relatedVisits(supabase, appointmentId), location.timezone);
  const result = await change();
  const ids = await recordMoveNotices(supabase, location, before);
  return { result, moved: ids.length ? { appointmentIds: ids, at } : null };
}
