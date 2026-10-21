// Approving, rejecting and undoing Denise's proposals. Approving checks the
// fix against the booking rules on the day as it will really go (with
// overruns and late clients), then applies it through the AI action log.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { applyAction, proposalFromJson, rejectAction, undoAction, type ActionResult, type Proposal } from "@/lib/scheduling/ai-actions";
import { describeProblem } from "@/lib/scheduling/booking";
import { toLocal } from "@/lib/scheduling/time";
import { adjustFor, loadDay, type Viewer } from "./scan";
import { clock, type Lookup } from "./wording";

type Supabase = SupabaseClient<Database>;

export type FixOutcome = { ok: true; date: string; message: string } | { ok: false; message: string };

async function loadProposal(supabase: Supabase, actionId: string): Promise<Proposal | null> {
  const { data, error } = await supabase.from("ai_actions").select("proposal").eq("id", actionId).maybeSingle();
  if (error) throw error;
  return data ? proposalFromJson(data.proposal) : null;
}

function dateOf(proposal: Proposal, timeZone: string): string | null {
  const first = proposal.changes[0]?.from.start ?? proposal.book?.items[0]?.start;
  return first ? toLocal(first, timeZone).date : null;
}

// First names of the clients a proposal moves.
function movedNames(proposal: Proposal, lookup: Lookup): string[] {
  const names = new Set<string>();
  for (const c of proposal.changes) {
    const from = c.from;
    const to = c.to;
    if (from.start.getTime() === to.start.getTime() && from.staffId === to.staffId) continue;
    names.add(lookup.visits.get(c.appointmentId)?.client?.firstName ?? "The walk-in");
  }
  return [...names];
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
  const notified = proposal.notifications?.length ? " and notified" : "";
  const message = names.length
    ? `Done — ${joinNames(names)} ${names.length > 1 ? "have" : "has"} been moved${notified}.`
    : "Done — I've swapped the chair, so no one needs to move.";
  return { ok: true, date, message };
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
