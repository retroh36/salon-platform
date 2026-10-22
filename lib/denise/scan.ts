// Denise looks over a day: loads the calendar and the day's reports, finds
// conflicts and fixes (lib/scheduling/resolve.ts), words them, and records
// the fixes as proposals in the AI action log for staff to approve. Run
// whenever the calendar is opened or something is reported.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { blockNotifications, notificationsFor } from "@/lib/notifications";
import { recordProposals, type ProposalOption } from "@/lib/scheduling/ai-actions";
import { loadDisruptions } from "@/lib/scheduling/disruptions";
import { loadBookingContext } from "@/lib/scheduling/load";
import { activeDisruptions, effectiveCalendar, findConflicts, type Conflict, type Day, type FixOption } from "@/lib/scheduling/resolve";
import { todayIn, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import type { ConflictView, DeniseNotice, DeniseState } from "./types";
import { clock, factsFor, headline, intro, moves, note, summary, templateReason, visitChanges, type Lookup, type Visit } from "./wording";

type Supabase = SupabaseClient<Database>;

export type Viewer = { location: { id: string; timezone: string }; salon: string; canBook: boolean };

export type FixFacts = ReturnType<typeof factsFor>;
// Writes plain-English explanations for fixes (Claude); null for any it
// couldn't.
export type Explainer = (facts: FixFacts[]) => Promise<(string | null)[]>;

export const FEATURE = "conflict_resolver";
// A client this late without checking in gets a nudge.
const LATE_NOTICE_MINUTES = 10;
const MINUTE = 60_000;

export type LoadedDay = { day: Day; lookup: Lookup };

// The day's calendar, statuses, reports and names.
export async function loadDay(supabase: Supabase, viewer: Viewer, date: LocalDate, now = new Date()): Promise<LoadedDay> {
  const ctx = await loadBookingContext(supabase, viewer.location, date, date);
  const appointmentIds = [...new Set(ctx.booked.map((b) => b.appointmentId!))];
  const [visits, staff, services, resources, disruptions] = await Promise.all([
    appointmentIds.length
      ? supabase.from("appointments").select("id, status, group_id, group:appointment_groups(id, label), client:clients(id, first_name, last_name)").in("id", appointmentIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("staff").select("id, first_name"),
    supabase.from("services").select("id, name"),
    supabase.from("resources").select("id, name").eq("location_id", viewer.location.id),
    loadDisruptions(supabase, viewer.location.id, date),
  ]);
  if (visits.error) throw visits.error;
  if (staff.error) throw staff.error;
  if (services.error) throw services.error;
  if (resources.error) throw resources.error;

  const visitMap = new Map<string, Visit>(
    visits.data.map((v) => [
      v.id,
      { status: v.status, client: v.client ? { id: v.client.id, firstName: v.client.first_name, fullName: fullName(v.client) } : null, group: v.group },
    ]),
  );
  return {
    day: {
      ctx,
      statuses: new Map(visits.data.map((v) => [v.id, v.status])),
      disruptions,
      now,
      groups: new Map(visits.data.flatMap((v) => (v.group_id ? [[v.id, v.group_id] as const] : []))),
    },
    lookup: {
      timeZone: viewer.location.timezone,
      salon: viewer.salon,
      items: new Map(ctx.booked.filter((b) => b.id).map((b) => [b.id!, b])),
      visits: visitMap,
      staff: new Map(staff.data.map((s) => [s.id, { firstName: s.first_name }])),
      services: new Map(services.data.map((s) => [s.id, s.name])),
      resources: new Map(resources.data.map((r) => [r.id, r.name])),
    },
  };
}

// Adjusts a calendar for the day's reports, for checking a fix again before
// it's applied.
export function adjustFor(day: Day) {
  const active = activeDisruptions(day);
  return (ctx: Day["ctx"]) => effectiveCalendar(ctx, active);
}

type Worded = { conflict: Conflict; options: { option: FixOption; summary: string; reason: string; needsReason: boolean }[] };

export async function scanDay(
  supabase: Supabase,
  viewer: Viewer,
  date: LocalDate,
  options: { now?: Date; explain?: Explainer | null } = {},
): Promise<DeniseState> {
  const now = options.now ?? new Date();
  const { day, lookup } = await loadDay(supabase, viewer, date, now);
  const conflicts = findConflicts(day);
  const prefix = `${date}:`;

  // Open proposals for the day: an unchanged option keeps its explanation.
  const existing = new Map<string, { summary: string; reason: string }>();
  if (viewer.canBook) {
    const { data, error } = await supabase
      .from("ai_actions")
      .select("subject, rank, summary, reason")
      .eq("location_id", viewer.location.id)
      .eq("feature", FEATURE)
      .eq("status", "proposed")
      .like("subject", `${prefix}%`);
    if (error) throw error;
    for (const row of data) existing.set(`${row.subject}#${row.rank}`, row);
  }

  const worded: Worded[] = conflicts.map((conflict) => ({
    conflict,
    options: conflict.options.map((option, i) => {
      const text = summary(option, lookup);
      const kept = existing.get(`${prefix}${conflict.subject}#${i + 1}`);
      const same = kept?.summary === text;
      return { option, summary: text, reason: same ? kept!.reason : templateReason(conflict, option, lookup), needsReason: !same };
    }),
  }));

  // New or changed fixes get Claude's explanation, when it's connected.
  if (options.explain) {
    const todo = worded.flatMap((w) => w.options.filter((o) => o.needsReason).map((o) => ({ w, o })));
    if (todo.length) {
      const reasons = await options.explain(todo.map(({ w, o }) => factsFor(w.conflict, o.option, lookup))).catch(() => todo.map(() => null));
      todo.forEach(({ o }, i) => {
        if (reasons[i]) o.reason = reasons[i]!;
      });
    }
  }

  const views: ConflictView[] = [];
  for (const w of worded) {
    const subject = `${prefix}${w.conflict.subject}`;
    let ids: (string | null)[] = w.options.map(() => null);
    if (viewer.canBook) {
      const recorded = await recordProposals(supabase, viewer.location.id, {
        feature: FEATURE,
        subject,
        options: w.options.map((o): ProposalOption => {
          const minute = (d: Date) => toLocal(d, lookup.timeZone).minute;
          const visits = notificationsFor(visitChanges(o.option, lookup));
          const breaks = blockNotifications(o.option.blockMoves.map((b) => ({ staffId: b.staffId, kind: b.kind, from: minute(b.from.start), to: minute(b.to.start) })));
          return {
            summary: o.summary,
            reason: o.reason,
            proposal: {
              changes: o.option.moves,
              notifications: [...visits.notifications, ...breaks.notifications],
              undoNotifications: [...visits.undo, ...breaks.undo],
              resolves: w.conflict.kind === "client_late" && w.conflict.disruptionId ? [w.conflict.disruptionId] : [],
              blockMoves: o.option.blockMoves.map((b) => ({
                blockId: b.blockId,
                date: b.date,
                from: { start: minute(b.from.start), end: minute(b.from.end) },
                to: { start: minute(b.to.start), end: minute(b.to.end) },
              })),
            },
          };
        }),
      });
      // Staff dismissed this one.
      if (w.options.length && !recorded.length) continue;
      ids = recorded;
    }
    views.push({
      subject,
      kind: w.conflict.kind,
      headline: headline(w.conflict, lookup),
      itemIds: [...new Set([...w.conflict.causeItemIds, ...w.conflict.displaced, ...w.conflict.stuck])],
      note: note(w.conflict, lookup),
      options: w.options.map((o, i) => ({
        actionId: ids[i],
        summary: o.summary,
        intro: intro(o.option, lookup),
        reason: o.reason,
        moves: moves(o.option, lookup),
        clientsMoved: o.option.clientsMoved,
        shiftMinutes: o.option.shiftMinutes,
        unresolved: [...new Set(o.option.unresolved.map((id) => lookup.visits.get(lookup.items.get(id)?.appointmentId ?? "")?.client?.fullName ?? "A walk-in"))],
      })),
    });
  }

  // Close proposals for problems that have gone away.
  if (viewer.canBook) {
    const current = new Set(views.map((v) => v.subject));
    const gone = new Set([...existing.keys()].map((k) => k.split("#")[0]).filter((s) => !current.has(s)));
    for (const subject of gone) await recordProposals(supabase, viewer.location.id, { feature: FEATURE, subject, options: [] });
  }

  return { date, conflicts: views, notices: lateNotices(day, lookup, date, conflicts), reorders: [], openings: [], connected: false };
}

// Clients due a little while ago who haven't checked in, today only.
function lateNotices(day: Day, lookup: Lookup, date: LocalDate, conflicts: Conflict[]): DeniseNotice[] {
  if (todayIn(lookup.timeZone, day.now) !== date) return [];
  const reported = new Set(day.disruptions.flatMap((d) => (d.kind === "client_late" ? [d.appointmentId] : [])));
  const inConflict = new Set(conflicts.flatMap((c) => [...c.causeItemIds, ...c.displaced]).map((id) => lookup.items.get(id)?.appointmentId));
  const firstItems = new Map<string, (typeof day.ctx.booked)[number]>();
  for (const b of day.ctx.booked) {
    const first = firstItems.get(b.appointmentId!);
    if (!first || b.start < first.start) firstItems.set(b.appointmentId!, b);
  }
  const notices: DeniseNotice[] = [];
  for (const [appointmentId, item] of firstItems) {
    const status = day.statuses.get(appointmentId);
    const late = (day.now.getTime() - item.start.getTime()) / MINUTE;
    if ((status !== "booked" && status !== "confirmed") || late < LATE_NOTICE_MINUTES || late > 60) continue;
    if (reported.has(appointmentId) || inConflict.has(appointmentId)) continue;
    const name = lookup.visits.get(appointmentId)?.client?.fullName ?? "A walk-in";
    notices.push({
      id: `late:${appointmentId}`,
      appointmentId,
      itemId: item.id!,
      text: `${name} was due at ${clock(toLocal(item.start, lookup.timeZone).minute)} and hasn't checked in yet. If they're on the way, tell me how late and I'll rearrange things.`,
    });
  }
  return notices;
}
