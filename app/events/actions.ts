"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { claudeClient } from "@/lib/denise/claude";
import { failureRef, logDeniseError } from "@/lib/denise/errors";
import { describeEvent } from "@/lib/denise/event-draft";
import { metered } from "@/lib/denise/usage";
import { builderProblems, memberKey, saveInput, timelineMembers, timelineOf, type BuilderState } from "@/lib/events/builder";
import { draftFrom, type EventDraft } from "@/lib/events/describe";
import { loadEventSettings, loadPackages } from "@/lib/events/load";
import { isUuid } from "@/lib/ids";
import { loadBookingContext } from "@/lib/scheduling/load";
import { CLASH_TEXT, heldSpan, laneKey, staffClash, type EventRole, type LaneSpan, type TimelineTask } from "@/lib/scheduling/events";
import { isLocalDate, todayIn } from "@/lib/scheduling/time";
import { isFrontOfHouse } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";

const NOT_ALLOWED = "Only the front desk, managers and owners can set up events.";

async function frontOfHouse() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && isFrontOfHouse(me.role) ? { supabase, me } : null;
}

export type DraftResult = { ok: true; draft: EventDraft; by: "denise" | "parser" } | { ok: false; message: string };

// Denise drafts the event from a one-line description. Nothing is saved:
// the builder fills in, and staff check and change it before saving.
export async function draftEvent(line: string): Promise<DraftResult> {
  const s = await frontOfHouse();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const text = line.trim().slice(0, 500);
  if (text.length < 5) return { ok: false, message: "Describe the event in a line first." };
  const client = claudeClient();
  const described = await describeEvent(client && metered(client, createAdminClient(), s.me.business_id, "event_draft"), text, (error) =>
    logDeniseError(error, { where: "drafting an event", businessId: s.me.business_id, ref: failureRef() }),
  );
  const packages = await loadPackages(s.supabase, s.me.business_id);
  const draft = draftFrom(described.description, packages, todayIn(s.me.location.timezone));
  if (!draft.members.length) return { ok: false, message: "I couldn't tell who's in the party. Try something like \"bride plus 4 bridesmaids hair and makeup\"." };
  return { ok: true, draft, by: described.by };
}

export type TeamCheck = Record<string, Record<string, string | null>>;

// Who's free for each artist lane on the event's day, by the booking rules
// (time off, booked clients, blocked time, other events): lane → staff id
// → why not (null when free).
export async function checkTeam(eventId: string | null, date: string, spans: LaneSpan[], travelMinutes: number): Promise<TeamCheck> {
  const s = await frontOfHouse();
  if (!s || !isLocalDate(date) || spans.length > 40) return {};
  const ctx = await loadBookingContext(s.supabase, s.me.location, date, date);
  // This event's own hold on the calendar doesn't count against it.
  const own = new Set<string>();
  const { data: team, error } = await s.supabase.from("staff").select("id, event_roles").eq("location_id", s.me.location.id).eq("is_active", true).filter("event_roles", "neq", "{}");
  if (error) throw error;
  const out: TeamCheck = {};
  for (const span of spans) {
    const held = heldSpan(span, travelMinutes);
    out[laneKey(span)] = Object.fromEntries(
      team.map((m) => {
        const clash = staffClash(ctx, { id: m.id, eventRoles: m.event_roles }, span.role as EventRole, date, held, own);
        return [m.id, clash ? CLASH_TEXT[clash] : null];
      }),
    );
  }
  return out;
}

export type SaveEventResult = { ok: true; id: string } | { ok: false; message: string };

// A dragged timeline must still give each person their package's time.
function tasksFit(tasks: readonly TimelineTask[], state: BuilderState, packages: Awaited<ReturnType<typeof loadPackages>>): boolean {
  const members = new Map(timelineMembers(state.members, packages).map((m) => [m.key, m]));
  for (const t of tasks) {
    if (t.kind === "touch_up") continue;
    const m = t.member ? members.get(t.member) : undefined;
    if (!m || t.end - t.start !== (t.kind === "hair" ? m.hairMinutes : m.makeupMinutes)) return false;
  }
  return state.members.every((_, i) => {
    const m = members.get(memberKey(i))!;
    return (m.hairMinutes === 0 || tasks.some((t) => t.member === m.key && t.kind === "hair")) && (m.makeupMinutes === 0 || tasks.some((t) => t.member === m.key && t.kind === "makeup"));
  });
}

export async function saveEvent(eventId: string | null, state: BuilderState): Promise<SaveEventResult> {
  const s = await frontOfHouse();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (eventId && !isUuid(eventId)) return { ok: false, message: "We couldn't find this event." };
  const tz = s.me.location.timezone;
  const [packages, settings] = await Promise.all([loadPackages(s.supabase, s.me.business_id), loadEventSettings(s.supabase, s.me.business_id)]);
  // Saving changes to an event that's already happened is allowed; a new
  // one needs a date ahead.
  const problems = builderProblems(state, packages, settings, eventId ? "0000-01-01" : todayIn(tz));
  if (problems.length) return { ok: false, message: problems[0] };
  const tasks = timelineOf(state, packages, settings);
  if (state.tasks && !tasksFit(state.tasks, state, packages)) return { ok: false, message: "The timeline doesn't match the party any more. Tap Work it out again." };
  const { data, error } = await s.supabase.rpc("save_event", { p_event_id: eventId!, p_input: saveInput(state, tasks, tz) as never });
  if (error) {
    if (["22023", "42501", "P0002", "55000"].includes(error.code ?? "")) return { ok: false, message: `${error.message}.` };
    throw error;
  }
  revalidatePath("/events");
  return { ok: true, id: data };
}
