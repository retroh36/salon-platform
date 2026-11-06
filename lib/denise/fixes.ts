// Approving, rejecting and undoing Denise's proposals. Approving checks the
// fix against the booking rules on the day as it will really go (with
// overruns and late clients), then applies it through the AI action log.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { applyAction, proposalFromJson, rejectAction, undoAction, type ActionResult, type Proposal } from "@/lib/scheduling/ai-actions";
import { describeProblem } from "@/lib/scheduling/booking";
import { ABSORB_MINUTES } from "@/lib/scheduling/resolve";
import { toLocal } from "@/lib/scheduling/time";
import { adjustFor, loadDay, type Viewer } from "./scan";
import { clock, type Lookup } from "./wording";
import type { Moved } from "./types";

type Supabase = SupabaseClient<Database>;

export type FixOutcome = { ok: true; date: string; message: string; moved?: Moved } | { ok: false; message: string };

async function loadProposal(supabase: Supabase, actionId: string): Promise<Proposal | null> {
  const { data, error } = await supabase.from("ai_actions").select("proposal").eq("id", actionId).maybeSingle();
  if (error) throw error;
  return data ? proposalFromJson(data.proposal) : null;
}

function dateOf(proposal: Proposal, timeZone: string): string | null {
  const first = proposal.changes[0]?.from.start ?? proposal.book?.items[0]?.start;
  return first ? toLocal(first, timeZone).date : null;
}

// The visits a proposal moves (to another time or stylist).
export function movedVisits(proposal: Proposal): string[] {
  const ids = new Set<string>();
  for (const c of proposal.changes) {
    if (c.from.start.getTime() === c.to.start.getTime() && c.from.staffId === c.to.staffId) continue;
    ids.add(c.appointmentId);
  }
  return [...ids];
}

// The delay a fix absorbed (resolve.ts, `absorbed`): one visit starting a
// little later with the same stylist and nothing else changed. The client
// still comes at their booked time; staff may tell them how far behind,
// rounded to 5 minutes, when it's 5 minutes or more (`minutes`, else 0).
export function absorbedDelay(proposal: Proposal): { appointmentId: string; from: { start: Date; staffId: string }; minutes: number } | null {
  const visits = movedVisits(proposal);
  if (visits.length !== 1 || proposal.blockMoves?.length || proposal.book) return null;
  const changes = proposal.changes.filter((c) => c.appointmentId === visits[0]);
  if (changes.some((c) => c.to.staffId !== c.from.staffId)) return null;
  const first = changes.reduce((a, b) => (b.from.start < a.from.start ? b : a));
  const shift = (first.to.start.getTime() - first.from.start.getTime()) / 60_000;
  if (shift <= 0 || shift > ABSORB_MINUTES) return null;
  return { appointmentId: visits[0], from: { start: first.from.start, staffId: first.from.staffId }, minutes: shift < 5 ? 0 : Math.round(shift / 5) * 5 };
}

// First names of the clients a proposal moves.
function movedNames(proposal: Proposal, lookup: Lookup): string[] {
  return [...new Set(movedVisits(proposal).map((id) => lookup.visits.get(id)?.client?.firstName ?? "The walk-in"))];
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function failureMessage(result: Exclude<ActionResult, { ok: true }>): string {
  switch (result.error) {
    case "invalid":
      return `That doesn't work any more: ${[...new Set(result.problems.map(describeProblem))].join(" ")} I'll look again.`;
    case "stale":
      return "The calendar changed since I suggested that, so I'll look again.";
    case "decided":
      return "Someone has already dealt with this one.";
    case "needs_client":
      return "Choose the client first.";
    case "forbidden":
      return "Only owners, managers and front desk can approve my suggestions.";
    case "not_found":
      return "I can't find that suggestion any more.";
    case "busy":
      return "The calendar kept changing while I was saving. Try again.";
  }
}

export async function approveFix(supabase: Supabase, viewer: Viewer, actionId: string, options: { now?: Date; clientId?: string | null } = {}): Promise<FixOutcome> {
  const proposal = await loadProposal(supabase, actionId);
  const date = proposal && dateOf(proposal, viewer.location.timezone);
  if (!proposal || !date) return { ok: false, message: failureMessage({ ok: false, error: "not_found" }) };

  const { day, lookup } = await loadDay(supabase, viewer, date, options.now);
  const result = await applyAction(supabase, viewer.location, actionId, { adjust: adjustFor(day), clientId: options.clientId });
  if (!result.ok) return { ok: false, message: failureMessage(result) };

  if (proposal.book) return { ok: true, date, message: "Done — it's booked." };
  const names = movedNames(proposal, lookup);
  if (!names.length) return { ok: true, date, message: "Done — I've swapped the chair, so no one needs to move." };
  // A delay absorbed: the client still comes at their time. Staff may let
  // them know how far behind (5 minutes or more); nothing is sent unless
  // they do.
  const behind = absorbedDelay(proposal);
  if (behind) {
    const at = clock(toLocal(behind.from.start, viewer.location.timezone).minute);
    const message = `Done. ${names[0]} still comes at ${at} and starts a little later.`;
    return behind.minutes ? { ok: true, date, message, moved: { appointmentIds: [behind.appointmentId], at: new Date().toISOString(), runningBehind: actionId } } : { ok: true, date, message };
  }
  // Applying sends nothing: each client's message waits for staff to check
  // and send it, so this never says anyone was told.
  const message = `Moved ${joinNames(names)}. ${names.length > 1 ? "Messages" : "Message"} ready to send.`;
  return { ok: true, date, message, moved: { appointmentIds: movedVisits(proposal), at: new Date().toISOString() } };
}

export async function undoFix(supabase: Supabase, viewer: Viewer, actionId: string, now?: Date): Promise<FixOutcome> {
  const proposal = await loadProposal(supabase, actionId);
  const date = proposal && dateOf(proposal, viewer.location.timezone);
  if (!proposal || !date) return { ok: false, message: failureMessage({ ok: false, error: "not_found" }) };

  const result = await undoAction(supabase, viewer.location, actionId);
  if (!result.ok) {
    if (result.error === "decided") return { ok: false, message: "That's already been undone." };
    if (result.error === "stale") return { ok: false, message: "It's changed since, so I can't put it back automatically." };
    if (result.error === "invalid") return { ok: false, message: `I can't put it back: ${[...new Set(result.problems.map(describeProblem))].join(" ")}` };
    return { ok: false, message: failureMessage(result) };
  }
  if (proposal.book) return { ok: true, date, message: "Undone — that booking has been removed." };

  const { lookup } = await loadDay(supabase, viewer, date, now);
  const first = proposal.changes[0];
  const names = movedNames(proposal, lookup);
  const message =
    names.length === 1
      ? `Undone — ${names[0]} is back at ${clock(toLocal(first.from.start, viewer.location.timezone).minute)}.`
      : "Undone — everything is back as it was.";
  return { ok: true, date, message };
}

export async function rejectFix(supabase: Supabase, actionId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await rejectAction(supabase, actionId);
  return result.ok ? result : { ok: false, message: failureMessage(result) };
}
