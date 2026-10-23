// Denise's view of a day for one staff member: conflicts and her fixes,
// notices (late arrivals), waitlist openings, reorder drafts and (today, for
// the front of house, on the Dashboard) the morning brief. Shared by the calendar's panel
// (app/calendar/denise-actions.ts) and the Dashboard.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { canReceiveOrders } from "@/lib/inventory";
import { loadBookingContext } from "@/lib/scheduling/load";
import { toLocal, type LocalDate } from "@/lib/scheduling/time";
import type { StaffRole } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { freedOn, loadWaitlist, waitlistOpenings } from "@/lib/waitlist-load";
import { briefFacts, withoutDismissed, type BriefFacts } from "./brief";
import { claudeClient, explainFixes, isConnected, type ClaudeClient } from "./claude";
import { suggestReorders } from "./reorder";
import { scanDay, type Viewer } from "./scan";
import type { DeniseState, WaitlistOpening } from "./types";
import { metered } from "./usage";

type Supabase = SupabaseClient<Database>;

export type DeniseAsker = {
  supabase: Supabase;
  role: StaffRole;
  businessId: string;
  viewer: Viewer;
  today: LocalDate;
};

// Claude, metered for this salon (tokens logged, daily limit), or null when
// Denise isn't connected.
export function claudeFor(businessId: string, feature: string): ClaudeClient | null {
  const client = claudeClient();
  return client ? metered(client, createAdminClient(), businessId, feature) : null;
}

// What's been dismissed from her brief and panel on the day (it stays gone).
export async function dismissedOn(supabase: Supabase, locationId: string, date: LocalDate): Promise<Set<string>> {
  const { data, error } = await supabase.from("denise_dismissals").select("item_key").eq("location_id", locationId).eq("day", date);
  if (error) throw error;
  return new Set(data.map((d) => d.item_key));
}

// Time that opened up on the day, matched to the waitlist.
export async function openingsOn(a: DeniseAsker, date: LocalDate): Promise<WaitlistOpening[]> {
  const tz = a.viewer.location.timezone;
  const entries = (await loadWaitlist(a.supabase, a.viewer.location.id, date)).filter((e) => e.fromDate <= date);
  if (!entries.length) return [];
  const [freed, ctx, { data: staff, error }] = await Promise.all([
    freedOn(a.supabase, a.viewer.location.id, date, tz),
    loadBookingContext(a.supabase, a.viewer.location, date, date),
    a.supabase.from("staff").select("id, first_name"),
  ]);
  if (error) throw error;
  const notBefore = date === a.today ? toLocal(new Date(), tz).minute : 0;
  return waitlistOpenings(ctx, date, freed, entries, new Map(staff.map((x) => [x.id, x.first_name])), notBefore);
}

// `brief`: also work out the morning brief (today, for the front of house:
// the Dashboard). The calendar's panel shows only what to act on now.
export async function deniseDay(a: DeniseAsker, date: LocalDate, options: { brief?: boolean; onStep?: (text: string) => void } = {}): Promise<DeniseState> {
  const connected = isConnected();
  // Reorders she's drafted on the Inventory page, for those who order.
  const reorders = canReceiveOrders(a.role)
    ? (await suggestReorders(a.supabase, { location: a.viewer.location, canManage: false })).map((r) => ({
        supplierId: r.supplierId,
        supplier: r.supplier,
        headline: r.headline,
        lines: r.lines.length,
        totalCents: r.totalCents,
        items: r.lines.slice(0, 3).map((l) => ({ product: l.product, reason: l.reason })),
      }))
    : [];
  // Past days can't be changed, so there's nothing to fix.
  if (date < a.today) return { date, conflicts: [], notices: [], reorders, openings: [], brief: null, connected };
  const client = claudeFor(a.businessId, "explain_fixes");
  const [state, openings, dismissed] = await Promise.all([
    scanDay(a.supabase, a.viewer, date, { explain: client ? (facts) => explainFixes(client, facts) : null, onStep: options.onStep }),
    a.viewer.canBook ? openingsOn(a, date) : Promise.resolve([]),
    a.viewer.canBook ? dismissedOn(a.supabase, a.viewer.location.id, date) : Promise.resolve(new Set<string>()),
  ]);
  const notices = state.notices.filter((n) => !dismissed.has(n.id));
  // The morning brief: today, for the front of house.
  let brief: BriefFacts | null = null;
  if (options.brief && date === a.today && a.viewer.canBook) {
    brief = withoutDismissed(await briefFacts(a.supabase, { businessId: a.businessId, location: a.viewer.location }, date, { conflicts: state.conflicts, openings }), dismissed);
  }
  return { ...state, notices, reorders, openings, brief, connected };
}
