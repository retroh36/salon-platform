"use server";

import { revalidatePath } from "next/cache";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { answer, type AssistantContext } from "@/lib/denise/assistant";
import { claudeClient, explainFixes, isConnected } from "@/lib/denise/claude";
import { approveFix, rejectFix, undoFix } from "@/lib/denise/fixes";
import { scanDay, type Viewer } from "@/lib/denise/scan";
import type { ChatMessage, DeniseState, FixResult } from "@/lib/denise/types";
import { isUuid } from "@/lib/ids";
import { recordProposals } from "@/lib/scheduling/ai-actions";
import type { BookingContext } from "@/lib/scheduling/booking";
import { LATE_MINUTES, reportCallOut, reportRunningLate } from "@/lib/scheduling/disruptions";
import { loadBookingContext, loadOffers, startOfLocalDay } from "@/lib/scheduling/load";
import { LEVEL_LABELS } from "@/lib/schedule-forms";
import { isLocalDate, todayIn } from "@/lib/scheduling/time";

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

async function look(s: Session, date: string): Promise<DeniseState> {
  // Past days can't be changed, so there's nothing to fix.
  const connected = isConnected();
  if (date < s.today) return { date, conflicts: [], notices: [], connected };
  const client = claudeClient();
  const state = await scanDay(s.supabase, s.viewer, date, { explain: client ? (facts) => explainFixes(client, facts) : null });
  return { ...state, connected };
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

// Ask Denise about the calendar. Claude answers using tools that call the
// scheduling functions; bookings it suggests become proposals to approve.
export async function askDenise(history: ChatMessage[], date: string): Promise<ChatMessage> {
  const s = await session();
  if (!s) return { role: "denise", text: NOT_SIGNED_IN };
  if (!isLocalDate(date) || !history.length) return { role: "denise", text: "What would you like to know?" };
  const client = claudeClient();
  if (!client) return { role: "denise", text: NOT_CONNECTED };

  const [services, staff] = await Promise.all([
    s.supabase.from("services").select("id, name, category, duration_minutes").is("archived_at", null).order("name"),
    s.supabase.from("staff").select("id, first_name, role, level").eq("location_id", s.viewer.location.id).eq("is_active", true),
  ]);
  if (services.error) throw services.error;
  if (staff.error) throw staff.error;
  const offers = await loadOffers(s.supabase, staff.data.map((m) => m.id));

  const calendars = new Map<string, Promise<BookingContext>>();
  const context: AssistantContext = {
    salon: s.viewer.salon,
    timeZone: s.viewer.location.timezone,
    today: s.today,
    date,
    now: new Date(),
    services: services.data.map((sv) => ({ id: sv.id, name: sv.name, category: sv.category, minutes: sv.duration_minutes ?? 0 })),
    staff: staff.data
      .filter((m) => (offers.get(m.id)?.size ?? 0) > 0)
      .map((m) => ({ id: m.id, firstName: m.first_name, title: m.level ? `${LEVEL_LABELS[m.level]} stylist` : m.role })),
    calendar: (day) => {
      if (!calendars.has(day)) calendars.set(day, loadBookingContext(s.supabase, s.viewer.location, day, day));
      return calendars.get(day)!;
    },
    propose: async (b) => {
      if (!s.viewer.canBook) return null;
      const [id] = await recordProposals(s.supabase, s.viewer.location.id, {
        feature: "ask_denise",
        subject: null,
        options: [{ summary: b.summary, reason: b.reason, proposal: { changes: [], book: { clientId: null, items: [{ serviceId: b.serviceId, staffId: b.staffId, resourceId: b.resourceId, start: b.start }] } } }],
      });
      return id ?? null;
    },
  };

  // Text only, starting with the staff member's question.
  const turns = history
    .slice(-12)
    .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), text: m.text.slice(0, 1000) }));
  while (turns.length && turns[0].role !== "user") turns.shift();

  try {
    const reply = await answer(client, context, turns);
    return { role: "denise", text: reply.text, suggestions: reply.suggestions };
  } catch {
    // No details: errors from the API aren't logged or shown.
    return { role: "denise", text: NOT_REACHED };
  }
}
