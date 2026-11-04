// What undoing one of Denise's fixes means for clients who were already
// told about it: who, when, and the correction staff would send ("please
// ignore our last message"). Undoing sends nothing; staff send the
// correction like the first message.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { channelFor, consentOf } from "@/lib/messaging/consent";
import { CONSENT_COLUMNS, previewTemplate } from "@/lib/messaging/send";
import { proposalFromJson, type Proposal } from "@/lib/scheduling/ai-actions";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { movedVisits } from "./fixes";

type Supabase = SupabaseClient<Database>;

export type Told = {
  appointmentId: string;
  firstName: string;
  // When the last message about the move went, "3:05pm".
  at: string;
  // The correction, as it will read once the visit is back.
  preview: { subject: string; body: string };
};

// Where each moved visit goes back to: its first service's place before.
function backTo(proposal: Proposal, appointmentId: string) {
  const first = proposal.changes.filter((c) => c.appointmentId === appointmentId).sort((x, y) => x.from.start.getTime() - y.from.start.getTime())[0];
  return first ? { start: first.from.start, staffId: first.from.staffId } : undefined;
}

// Clients a fix moved who have been messaged since it was applied.
export async function toldAboutFix(supabase: Supabase, timeZone: string, actionId: string): Promise<Told[]> {
  const { data: action, error } = await supabase.from("ai_actions").select("status, proposal, decided_at").eq("id", actionId).maybeSingle();
  if (error) throw error;
  if (!action || action.status !== "approved" || !action.decided_at) return [];
  const proposal = proposalFromJson(action.proposal);
  const ids = movedVisits(proposal);
  if (!ids.length) return [];
  const [{ data: sent }, { data: visits }] = await Promise.all([
    supabase
      .from("client_messages")
      .select("appointment_id, created_at")
      .in("appointment_id", ids)
      .gte("created_at", action.decided_at)
      .neq("template", "visit_move_undone")
      .order("created_at", { ascending: false }),
    supabase.from("appointments").select(`id, client:clients(first_name, ${CONSENT_COLUMNS})`).in("id", ids),
  ]);
  const told: Told[] = [];
  for (const id of ids) {
    const last = sent?.find((m) => m.appointment_id === id);
    const client = visits?.find((v) => v.id === id)?.client;
    if (!last || !client) continue;
    const channel = channelFor(consentOf(client), "appointment")?.channel ?? "sms";
    const preview = await previewTemplate(supabase, { appointmentId: id, template: "visit_move_undone", channel }, backTo(proposal, id));
    if (!preview) continue;
    told.push({ appointmentId: id, firstName: client.first_name, at: formatMinute(toLocal(new Date(last.created_at), timeZone).minute), preview });
  }
  return told;
}
