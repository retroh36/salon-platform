"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { answer } from "@/lib/denise/assistant";
import { briefFacts, briefTemplate, type Brief, type BriefFacts } from "@/lib/denise/brief";
import { ANALYSIS_MODEL, claudeClient, explainFixes, firstNamesOnly, isConnected, writeBrief, type ClaudeClient } from "@/lib/denise/claude";
import { assistantContext } from "@/lib/denise/context";
import { approveFix, rejectFix, undoFix } from "@/lib/denise/fixes";
import { suggestReorders } from "@/lib/denise/reorder";
import { scanDay, type Viewer } from "@/lib/denise/scan";
import type { ChatMessage, DeniseState, FixResult, WaitlistOpening } from "@/lib/denise/types";
import { DailyLimitReached, metered } from "@/lib/denise/usage";
import { isUuid } from "@/lib/ids";
import { canReceiveOrders } from "@/lib/inventory";
import { LATE_MINUTES, reportCallOut, reportRunningLate } from "@/lib/scheduling/disruptions";
import { loadBookingContext, startOfLocalDay } from "@/lib/scheduling/load";
import { isLocalDate, todayIn, toLocal } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { freedOn, loadWaitlist, waitlistOpenings } from "@/lib/waitlist-load";
import { bookWaitlistEntry } from "@/lib/waitlist-book";

const NOT_SIGNED_IN = "Sign in again.";

function refresh() {
  revalidatePath("/calendar", "layout");
}

async function session() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return null;
  const viewer: Viewer = {
    location: { id: me.location.id, timezone: me.location.timezone },
    salon: me.location.business?.name ?? "the salon",
    canBook: canBook(me.role),
  };
  return { supabase, me, viewer, today: todayIn(me.location.timezone) };
}

type Session = NonNullable<Awaited<ReturnType<typeof session>>>;

// Claude, metered for this salon (tokens logged, daily limit), or null when
// Denise isn't connected.
function claudeFor(s: Session, feature: string): ClaudeClient | null {
  const client = claudeClient();
  return client ? metered(client, createAdminClient(), s.me.business_id, feature) : null;
}

// Claude rewrites the brief at most this often while the facts keep
// changing; in between, the template (always up to date) shows.
const BRIEF_REWRITE_MS = 20 * 60_000;

async function briefFor(s: Session, facts: BriefFacts): Promise<Brief> {
  const template: Brief = { facts, text: briefTemplate(facts), writtenBy: "template" };
  const client = claudeFor(s, "morning_brief");
  if (!client) return template;
  const admin = createAdminClient();
  const hash = createHash("sha256").update(JSON.stringify(firstNamesOnly(facts))).digest("hex");
  const { data: cached } = await admin.from("denise_briefs").select("facts_hash, text, created_at").eq("location_id", s.viewer.location.id).eq("day", facts.date).maybeSingle();
  if (cached?.facts_hash === hash) return { facts, text: cached.text, writtenBy: "claude" };
  if (cached && Date.now() - new Date(cached.created_at).getTime() < BRIEF_REWRITE_MS) return template;
  const text = await writeBrief(client, facts).catch(() => null);
  if (!text) return template;
  await admin.from("denise_briefs").upsert({ location_id: s.viewer.location.id, day: facts.date, facts_hash: hash, text, model: ANALYSIS_MODEL, created_at: new Date().toISOString() });
  return { facts, text, writtenBy: "claude" };
}

async function look(s: Session, date: string): Promise<DeniseState> {
  const connected = isConnected();
  // Reorders she's drafted on the Inventory page, for those who order.
  const reorders = canReceiveOrders(s.me.role)
    ? (await suggestReorders(s.supabase, { location: s.viewer.location, canManage: false })).map((r) => ({
        supplierId: r.supplierId,
        supplier: r.supplier,
        headline: r.headline,
        lines: r.lines.length,
        totalCents: r.totalCents,
      }))
    : [];
  // Past days can't be changed, so there's nothing to fix.
  if (date < s.today) return { date, conflicts: [], notices: [], reorders, openings: [], brief: null, connected };
  const client = claudeFor(s, "explain_fixes");
  const [state, openings] = await Promise.all([
    scanDay(s.supabase, s.viewer, date, { explain: client ? (facts) => explainFixes(client, facts) : null }),
    s.viewer.canBook ? openingsOn(s, date) : Promise.resolve([]),
  ]);
  // The morning brief: today, for the front of house.
  let brief: Brief | null = null;
  if (date === s.today && s.viewer.canBook) {
    const facts = await briefFacts(s.supabase, { businessId: s.me.business_id, location: s.viewer.location }, date, { conflicts: state.conflicts, openings });
    brief = await briefFor(s, facts);
  }
  return { ...state, reorders, openings, brief, connected };
}

// Time that opened up on the day, matched to the waitlist.
async function openingsOn(s: Session, date: string): Promise<WaitlistOpening[]> {
  const tz = s.viewer.location.timezone;
  const entries = (await loadWaitlist(s.supabase, s.viewer.location.id, date)).filter((e) => e.fromDate <= date);
  if (!entries.length) return [];
  const [freed, ctx, { data: staff, error }] = await Promise.all([
    freedOn(s.supabase, s.viewer.location.id, date, tz),
    loadBookingContext(s.supabase, s.viewer.location, date, date),
    s.supabase.from("staff").select("id, first_name"),
  ]);
  if (error) throw error;
  const notBefore = date === s.today ? toLocal(new Date(), tz).minute : 0;
  return waitlistOpenings(ctx, date, freed, entries, new Map(staff.map((x) => [x.id, x.first_name])), notBefore);
}

// Books a waitlist client into an opening Denise found (staff choose and
// tell the client; Denise doesn't contact them).
export async function bookFromWaitlist(entryId: string, staffId: string, date: string, startMinute: number): Promise<FixResult> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_SIGNED_IN };
  if (!s.viewer.canBook) return { ok: false, message: "Only the front desk, managers and owners can book." };
  if (!isUuid(entryId) || !isUuid(staffId) || !isLocalDate(date)) return { ok: false, message: "That opening isn't there any more." };
  const result = await bookWaitlistEntry(s.supabase, s.viewer.location, entryId, staffId, date, startMinute);
  refresh();
  return { ...result, state: await look(s, date) };
}

// Denise looks over the day: conflicts, her fixes, and notices.
export async function scanDenise(date: string): Promise<DeniseState | null> {
  const s = await session();
  if (!s || !isLocalDate(date)) return null;
  return look(s, date);
}

export type ReportResult = { ok: true; state: DeniseState } | { ok: false; message: string };

const REPORT_ERRORS = {
  forbidden: "Only the front desk, managers and owners, or the stylist on this visit, can report that.",
  over: "This visit is already over.",
  invalid: "Choose how many minutes.",
};

export async function reportLate(itemId: string, minutes: number, date: string): Promise<ReportResult> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_SIGNED_IN };
  if (!isUuid(itemId) || !isLocalDate(date)) return { ok: false, message: "That appointment no longer exists." };
  if (!LATE_MINUTES.includes(minutes)) return { ok: false, message: REPORT_ERRORS.invalid };
  if (date < s.today) return { ok: false, message: REPORT_ERRORS.over };
  const result = await reportRunningLate(s.supabase, itemId, minutes);
  if (!result.ok) return { ok: false, message: REPORT_ERRORS[result.error] };
  return { ok: true, state: await look(s, date) };
}

// Out for the rest of today, or all of a later day.
export async function reportOut(staffId: string, date: string): Promise<ReportResult> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_SIGNED_IN };
  if (!isUuid(staffId) || !isLocalDate(date)) return { ok: false, message: "That stylist isn't here." };
  if (date < s.today) return { ok: false, message: "That day is over." };
  const from = date === s.today ? new Date() : startOfLocalDay(date, s.viewer.location.timezone);
  const result = await reportCallOut(s.supabase, staffId, from);
  if (!result.ok) return { ok: false, message: result.error === "forbidden" ? "Only the front desk, managers and owners can mark someone else out." : "That didn't work. Try again." };
  refresh();
  return { ok: true, state: await look(s, date) };
}

async function decide(actionId: string, date: string, run: (s: Session) => Promise<{ ok: true; message: string } | { ok: false; message: string }>): Promise<FixResult> {
  const s = await session();
  if (!s) return { ok: false, message: NOT_SIGNED_IN };
  if (!isUuid(actionId) || !isLocalDate(date)) return { ok: false, message: "I can't find that suggestion any more." };
  const result = await run(s);
  refresh();
  const state = await look(s, date);
  return result.ok ? { ok: true, message: result.message, state } : { ok: false, message: result.message, state };
}

export async function approveDeniseFix(actionId: string, date: string, clientId: string | null = null): Promise<FixResult> {
  return decide(actionId, date, (s) => approveFix(s.supabase, s.viewer, actionId, { clientId: clientId && isUuid(clientId) ? clientId : null }));
}

export async function undoDeniseFix(actionId: string, date: string): Promise<FixResult> {
  return decide(actionId, date, (s) => undoFix(s.supabase, s.viewer, actionId));
}

export async function rejectDeniseFix(actionId: string, date: string): Promise<FixResult> {
  return decide(actionId, date, async (s) => {
    const result = await rejectFix(s.supabase, actionId);
    return result.ok ? { ok: true, message: "Okay, I'll leave that one." } : result;
  });
}

const NOT_CONNECTED =
  "I'm not connected yet, so I can't answer questions. Once I am, ask me things like “Who's free for a color at 3?” In the meantime I'm still watching the calendar for clashes.";

const NOT_REACHED = "I couldn't think that through just now. Try again in a moment.";

const LIMIT_REACHED = "I've used up today's thinking for the salon, so I'll be back for questions tomorrow. I'm still watching the calendar for clashes in the meantime.";


// Ask Denise about the calendar. Claude answers using tools that call the
// scheduling functions; bookings it suggests become proposals to approve.
export async function askDenise(history: ChatMessage[], date: string): Promise<ChatMessage> {
  const s = await session();
  if (!s) return { role: "denise", text: NOT_SIGNED_IN };
  if (!isLocalDate(date) || !history.length) return { role: "denise", text: "What would you like to know?" };
  const client = claudeFor(s, "ask_denise");
  if (!client) return { role: "denise", text: NOT_CONNECTED };

  const context = await assistantContext(
    s.supabase,
    { role: s.me.role, staffId: s.me.id, businessId: s.me.business_id, location: s.viewer.location, salon: s.viewer.salon, today: s.today },
    date,
  );

  // Text only, starting with the staff member's question.
  const turns = history
    .slice(-12)
    .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), text: m.text.slice(0, 1000) }));
  while (turns.length && turns[0].role !== "user") turns.shift();

  try {
    const reply = await answer(client, context, turns);
    return { role: "denise", text: reply.text, suggestions: reply.suggestions };
  } catch (error) {
    if (error instanceof DailyLimitReached) return { role: "denise", text: LIMIT_REACHED };
    // No details: errors from the API aren't logged or shown.
    return { role: "denise", text: NOT_REACHED };
  }
}
