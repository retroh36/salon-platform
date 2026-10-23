// Denise's view of a day for one staff member: conflicts and her fixes,
// notices, waitlist openings, reorder drafts and (today, for the front of
// house) the morning brief. Shared by the calendar's panel
// (app/calendar/denise-actions.ts) and the Dashboard.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import type { Database } from "@/lib/database.types";
import { canReceiveOrders } from "@/lib/inventory";
import { loadBookingContext } from "@/lib/scheduling/load";
import { toLocal, type LocalDate } from "@/lib/scheduling/time";
import type { StaffRole } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { freedOn, loadWaitlist, waitlistOpenings } from "@/lib/waitlist-load";
import { briefFacts, briefTemplate, type Brief, type BriefFacts } from "./brief";
import { ANALYSIS_MODEL, claudeClient, explainFixes, firstNamesOnly, isConnected, writeBrief, type ClaudeClient } from "./claude";
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

// Claude rewrites the brief at most this often while the facts keep
// changing; in between, the template (always up to date) shows.
const BRIEF_REWRITE_MS = 20 * 60_000;

const factsHash = (facts: BriefFacts) => createHash("sha256").update(JSON.stringify(firstNamesOnly(facts))).digest("hex");

// The brief for these facts: Denise's cached words when they're for the
// same facts, else the template. "write" asks Claude for new words when
// they're due and waits for them (the calendar); "cached" never waits: it
// shows what's there and writes new words after the response (the
// Dashboard), so loading it doesn't call the API each time.
export async function briefFor(a: DeniseAsker, facts: BriefFacts, mode: "write" | "cached"): Promise<Brief> {
  const template: Brief = { facts, text: briefTemplate(facts), writtenBy: "template" };
  const client = claudeFor(a.businessId, "morning_brief");
  if (!client) return template;
  const admin = createAdminClient();
  const hash = factsHash(facts);
  const { data: cached } = await admin.from("denise_briefs").select("facts_hash, text, created_at").eq("location_id", a.viewer.location.id).eq("day", facts.date).maybeSingle();
  if (cached?.facts_hash === hash) return { facts, text: cached.text, writtenBy: "claude" };
  if (cached && Date.now() - new Date(cached.created_at).getTime() < BRIEF_REWRITE_MS) return template;
  const write = async () => {
    const text = await writeBrief(client, facts).catch(() => null);
    if (text) await admin.from("denise_briefs").upsert({ location_id: a.viewer.location.id, day: facts.date, facts_hash: hash, text, model: ANALYSIS_MODEL, created_at: new Date().toISOString() });
    return text;
  };
  if (mode === "cached") {
    after(write);
    return template;
  }
  const text = await write();
  return text ? { facts, text, writtenBy: "claude" } : template;
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

export async function deniseDay(a: DeniseAsker, date: LocalDate, options: { brief: "write" | "cached" } = { brief: "write" }): Promise<DeniseState> {
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
  const [state, openings] = await Promise.all([
    scanDay(a.supabase, a.viewer, date, { explain: client ? (facts) => explainFixes(client, facts) : null }),
    a.viewer.canBook ? openingsOn(a, date) : Promise.resolve([]),
  ]);
  // The morning brief: today, for the front of house.
  let brief: Brief | null = null;
  if (date === a.today && a.viewer.canBook) {
    const facts = await briefFacts(a.supabase, { businessId: a.businessId, location: a.viewer.location }, date, { conflicts: state.conflicts, openings });
    brief = await briefFor(a, facts, options.brief);
  }
  return { ...state, reorders, openings, brief, connected };
}
