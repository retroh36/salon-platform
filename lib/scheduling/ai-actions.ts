// The AI action log: proposals from Denise, the AI assistant, and applying,
// rejecting or undoing them.
//
// Denise never changes the calendar herself. She records proposals here,
// and a person approves one. Applying checks the proposal against the
// booking rules (./booking.ts) on the current calendar, then saves through
// the database's apply_ai_action, which records the exact previous state.
// Undo checks that the old places are still free, then restores them
// through undo_ai_action. Both use the location's calendar_version, like
// ./book.ts, so a change made in the meantime makes them re-check.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { busyDuring, checkAppointment, checkMoves, type BookedItem, type BookingContext, type BookingProblem, type MoveRequest, type ServiceTiming } from "./booking.ts";
import { loadBookingContext } from "./load.ts";
import { fromLocal, toLocal } from "./time.ts";

type Supabase = SupabaseClient<Database>;
type Location = { id: string; timezone: string };

export type Placement = { staffId: string; resourceId: string | null; start: Date };

// Move a booked item from one place to another.
export type ItemChange = { itemId: string; appointmentId: string; from: Placement; to: Placement };

export type ProposedBooking = {
  clientId: string | null;
  // timing: the length Denise searched with (the stylist's usual time),
  // else the stylist's own length.
  items: { serviceId: string; staffId: string; resourceId: string | null; start: Date; timing?: ServiceTiming }[];
};

// A message to a client or stylist, recorded when the change is applied.
export type NotificationDraft = { appointmentId: string | null; template: string; body: string } & (
  | { clientId: string; staffId?: never }
  | { staffId: string; clientId?: never }
);

export type Proposal = {
  changes: ItemChange[];
  book?: ProposedBooking | null;
  notifications?: NotificationDraft[];
  // Sent on undo instead, to anyone the notifications already reached.
  undoNotifications?: NotificationDraft[];
  // Reports (schedule_disruptions) this deals with, e.g. a late client
  // whose visit it moves.
  resolves?: string[];
  // Lunches and breaks moved to make room, in local minutes on the day.
  blockMoves?: ProposedBlockMove[];
};

export type ProposedBlockMove = { blockId: string; date: string; from: { start: number; end: number }; to: { start: number; end: number } };

export type ProposalOption = { summary: string; reason: string; proposal: Proposal };

export type ActionStatus = Database["public"]["Enums"]["ai_action_status"];

export type ActionError =
  | "not_found"
  // Approved or rejected already (or, for undo, not applied).
  | "decided"
  // Something it touches changed since: moved, checked in, or gone.
  | "stale"
  | "needs_client"
  | "forbidden"
  | "busy";

export type ActionResult = { ok: true } | { ok: false; error: "invalid"; problems: BookingProblem[] } | { ok: false; error: ActionError };

const ATTEMPTS = 3;

function placementJson(p: Placement) {
  return { staff_id: p.staffId, resource_id: p.resourceId, starts_at: p.start.toISOString() };
}

function placementFrom(json: { staff_id: string; resource_id: string | null; starts_at: string }): Placement {
  return { staffId: json.staff_id, resourceId: json.resource_id, start: new Date(json.starts_at) };
}

function notificationJson(n: NotificationDraft) {
  return { appointment_id: n.appointmentId, client_id: n.clientId ?? null, staff_id: n.staffId ?? null, template: n.template, body: n.body };
}

export function proposalToJson(p: Proposal): Json {
  return {
    notifications: (p.notifications ?? []).map(notificationJson),
    undo_notifications: (p.undoNotifications ?? []).map(notificationJson),
    resolves: p.resolves ?? [],
    block_moves: (p.blockMoves ?? []).map((m) => ({ block_id: m.blockId, on_date: m.date, from: m.from, to: m.to })),
    changes: p.changes.map((c) => ({ item_id: c.itemId, appointment_id: c.appointmentId, from: placementJson(c.from), to: placementJson(c.to) })),
    book: p.book
      ? {
          client_id: p.book.clientId,
          items: p.book.items.map((i) => ({
            service_id: i.serviceId,
            staff_id: i.staffId,
            resource_id: i.resourceId,
            starts_at: i.start.toISOString(),
            timing: i.timing ? { active: i.timing.activeMinutes, processing: i.timing.processingMinutes, finishing: i.timing.finishingMinutes } : null,
          })),
        }
      : null,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- JSON from our own functions */
function notificationFrom(n: any): NotificationDraft {
  const base = { appointmentId: n.appointment_id, template: n.template, body: n.body };
  return n.client_id ? { ...base, clientId: n.client_id } : { ...base, staffId: n.staff_id };
}

export function proposalFromJson(json: Json): Proposal {
  const j = json as any;
  return {
    notifications: (j.notifications ?? []).map(notificationFrom),
    undoNotifications: (j.undo_notifications ?? []).map(notificationFrom),
    resolves: j.resolves ?? [],
    blockMoves: (j.block_moves ?? []).map((m: any) => ({ blockId: m.block_id, date: m.on_date, from: m.from, to: m.to })),
    changes: (j.changes ?? []).map((c: any) => ({ itemId: c.item_id, appointmentId: c.appointment_id, from: placementFrom(c.from), to: placementFrom(c.to) })),
    book: j.book
      ? {
          clientId: j.book.client_id ?? null,
          items: j.book.items.map((i: any) => ({
            serviceId: i.service_id,
            staffId: i.staff_id,
            resourceId: i.resource_id ?? null,
            start: new Date(i.starts_at),
            timing: i.timing ? { activeMinutes: i.timing.active, processingMinutes: i.timing.processing, finishingMinutes: i.timing.finishing } : undefined,
          })),
        }
      : null,
  };
}

type PreviousItem = { itemId: string; staffId: string; resourceId: string | null; start: Date };

function previousFromJson(json: Json): { items: PreviousItem[]; createdAppointmentId: string | null } {
  const j = json as any;
  return {
    items: (j.items ?? []).map((i: any) => ({ itemId: i.item_id, staffId: i.staff_id, resourceId: i.resource_id ?? null, start: new Date(i.starts_at) })),
    createdAppointmentId: j.created_appointment_id ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Whether a proposal can be made on this calendar: its moves, or its new
// booking, pass the booking rules. Problems from every part, deduplicated.
export function checkProposal(base: BookingContext, proposal: Proposal): BookingProblem[] {
  const problems: BookingProblem[] = [];
  // Moved lunches and breaks first: they must still be where they were, and
  // clients are checked against their new times.
  let ctx = base;
  for (const m of proposal.blockMoves ?? []) {
    const block = (ctx.blocks ?? []).find((b) => b.blockId === m.blockId && b.date === m.date);
    const start = fromLocal(m.date, m.to.start, ctx.location.timeZone);
    const end = fromLocal(m.date, m.to.end, ctx.location.timeZone);
    if (!block || !start || !end) return [{ code: "not_booked" }];
    ctx = { ...ctx, blocks: (ctx.blocks ?? []).map((b) => (b === block ? { ...b, start, end } : b)) };
    const movedIds = new Set(proposal.changes.map((c) => c.itemId));
    const after: BookedItem[] = proposal.changes.flatMap((c) => {
      const old = ctx.booked.find((b) => b.id === c.itemId);
      return old ? [{ ...old, ...c.to }] : [];
    });
    const clash = busyDuring({ ...ctx, booked: ctx.booked.filter((b) => !b.id || !movedIds.has(b.id)) }, block.staffId, start, end, after);
    if (clash.length) problems.push({ code: "staff_double_booked", conflictWith: clash[0].id });
  }
  if (proposal.changes.length) {
    problems.push(...checkMoves(ctx, proposal.changes.map((c) => ({ itemId: c.itemId, ...c.to }))).problems.flat());
  }
  if (proposal.book) {
    const check = checkAppointment(ctx, proposal.book.items);
    if (!check.valid) problems.push(...check.items.flatMap((i) => (i.valid ? [] : i.problems)));
  }
  const seen = new Set<string>();
  return problems.filter((p) => !seen.has(p.code) && seen.add(p.code));
}

function datesOf(location: Location, instants: Date[]): [string, string] {
  const dates = instants.map((d) => toLocal(d, location.timezone).date).sort();
  return [dates[0], dates.at(-1)!];
}

function rpcError(code: string | undefined): ActionError | null {
  switch (code) {
    case "42501":
      return "forbidden";
    case "P0002":
      return "not_found";
    case "55000":
      return "stale";
    default:
      return null;
  }
}

// Records the current options for a problem, best first, replacing the
// ones recorded before. Returns their ids; none if staff rejected this
// problem's options before.
// asSystem: recorded by the server itself (the morning risk check), with
// the service role; otherwise as the front-of-house staff member.
export async function recordProposals(
  supabase: Supabase,
  locationId: string,
  input: { feature: string; subject: string | null; options: ProposalOption[] },
  { asSystem = false }: { asSystem?: boolean } = {},
): Promise<string[]> {
  const { data, error } = await supabase.rpc(asSystem ? "record_ai_proposals_as_system" : "record_ai_proposals", {
    p_location_id: locationId,
    p_feature: input.feature,
    p_subject: input.subject!,
    p_options: input.options.map((o) => ({ summary: o.summary, reason: o.reason, proposal: proposalToJson(o.proposal) })),
  });
  if (error) throw error;
  return data;
}

export type ApplyOptions = {
  // The client for a new booking that doesn't have one yet.
  clientId?: string | null;
  // Adjusts the calendar the proposal is checked against (e.g. to add an
  // overrun that isn't a booking).
  adjust?: (ctx: BookingContext) => BookingContext;
};

export async function applyAction(supabase: Supabase, location: Location, actionId: string, options: ApplyOptions = {}): Promise<ActionResult> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const version = await supabase.from("locations").select("calendar_version").eq("id", location.id).single();
    if (version.error) throw version.error;

    const { data: action, error } = await supabase.from("ai_actions").select("status, proposal").eq("id", actionId).maybeSingle();
    if (error) throw error;
    if (!action) return { ok: false, error: "not_found" };
    if (action.status !== "proposed") return { ok: false, error: "decided" };

    const proposal = proposalFromJson(action.proposal);
    if (proposal.book) {
      const clientId = options.clientId ?? proposal.book.clientId;
      if (!clientId) return { ok: false, error: "needs_client" };
    }
    const instants = [...proposal.changes.flatMap((c) => [c.from.start, c.to.start]), ...(proposal.book?.items.map((i) => i.start) ?? [])];
    if (instants.length === 0) return { ok: false, error: "not_found" };
    const ctx = await loadBookingContext(supabase, location, ...datesOf(location, instants));

    const problems = checkProposal(options.adjust ? options.adjust(ctx) : ctx, proposal);
    if (problems.length) {
      // An item no longer on the calendar means things changed, not a rule.
      if (problems.some((p) => p.code === "not_booked")) return { ok: false, error: "stale" };
      return { ok: false, error: "invalid", problems };
    }

    const { error: rpcErr } = await supabase.rpc("apply_ai_action", {
      p_action_id: actionId,
      p_expected_version: version.data.calendar_version,
      p_client_id: options.clientId ?? null!,
    });
    if (rpcErr?.code === "40001") continue;
    const known = rpcError(rpcErr?.code);
    if (known) return { ok: false, error: known };
    if (rpcErr) throw rpcErr;
    return { ok: true };
  }
  return { ok: false, error: "busy" };
}

// Puts back everything an applied action changed, if the old places are
// still free.
export async function undoAction(supabase: Supabase, location: Location, actionId: string): Promise<ActionResult> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const version = await supabase.from("locations").select("calendar_version").eq("id", location.id).single();
    if (version.error) throw version.error;

    const { data: action, error } = await supabase.from("ai_actions").select("status, previous_state").eq("id", actionId).maybeSingle();
    if (error) throw error;
    if (!action) return { ok: false, error: "not_found" };
    if (action.status !== "approved" || !action.previous_state) return { ok: false, error: "decided" };

    const previous = previousFromJson(action.previous_state);
    if (previous.items.length) {
      const restores: MoveRequest[] = previous.items.map((p) => ({ itemId: p.itemId, staffId: p.staffId, resourceId: p.resourceId, start: p.start }));
      const ctx = await loadBookingContext(supabase, location, ...datesOf(location, restores.map((r) => r.start)));
      const check = checkMoves(ctx, restores);
      if (!check.valid) {
        const problems = check.problems.flat();
        if (problems.some((p) => p.code === "not_booked")) return { ok: false, error: "stale" };
        return { ok: false, error: "invalid", problems };
      }
    }

    const { error: rpcErr } = await supabase.rpc("undo_ai_action", { p_action_id: actionId, p_expected_version: version.data.calendar_version });
    if (rpcErr?.code === "40001") continue;
    const known = rpcError(rpcErr?.code);
    if (known) return { ok: false, error: known };
    if (rpcErr) throw rpcErr;
    return { ok: true };
  }
  return { ok: false, error: "busy" };
}

// Dismisses a proposal and the other options for the same problem.
export async function rejectAction(supabase: Supabase, actionId: string): Promise<{ ok: true } | { ok: false; error: ActionError }> {
  const { error } = await supabase.rpc("reject_ai_action", { p_action_id: actionId });
  const known = rpcError(error?.code);
  if (known) return { ok: false, error: known === "stale" ? "decided" : known };
  if (error) throw error;
  return { ok: true };
}
