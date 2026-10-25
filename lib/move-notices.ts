// Notices when staff move visits (editing them, dragging them, or moving
// them to another day), like Denise's fixes: a snapshot of each visit's
// first service before the change, then, once it's saved, a notice to the
// client and each stylist involved for every visit whose day, time or
// stylist changed (lib/notifications.ts, fixed templates). Recorded through
// record_visit_notices until texts are connected. A notice that can't be
// recorded never undoes the move; it's logged.

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

export const snapshotVisits = load;

// After the change: a notice for each visit that moved.
export async function recordMoveNotices(supabase: Supabase, location: { timezone: string }, before: Snapshot): Promise<number> {
  try {
    const after = await load(supabase, [...before.keys()], location.timezone);
    const { data: salon } = await supabase.from("businesses").select("name").limit(1).maybeSingle();
    const today = todayIn(location.timezone);
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return 0;
    const server = createAdminClient();
    let recorded = 0;
    for (const [appointmentId, was] of before) {
      const now = after.get(appointmentId);
      if (!was.first || !now?.first) continue;
      const notices = moveNotices({
        appointmentId,
        client: now.client,
        salon: salon?.name ?? "the salon",
        service: now.first.service,
        today,
        from: was.first,
        to: now.first,
      });
      if (!notices.length) continue;
      // Recorded by the server, as the person who moved it, so nobody can
      // send notice text of their own in.
      const { error } = await server.rpc("record_visit_notices_for_user", {
        p_user_id: user.id,
        p_appointment_id: appointmentId,
        p_notices: notices.map((n) => ({ template: n.template, body: n.body, client_id: "clientId" in n ? n.clientId : null, staff_id: "staffId" in n ? n.staffId : null })),
      });
      if (error) throw error;
      recorded += notices.length;
    }
    return recorded;
  } catch (error) {
    console.error("Couldn't record move notices:", error instanceof Error ? error.message : error);
    return 0;
  }
}
