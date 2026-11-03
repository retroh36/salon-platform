"use server";

// The message for each client a change moved, one of Denise's fixes or
// staff's own (a drag, Edit booking, Move to another day): the change sends
// nothing, so staff see "Your visit has moved" filled in from the visit as
// it is now, change it if their role may write its own, and send it through
// the consent rules (./moved-messages.tsx, ./move-prompt.tsx). Front of
// house only.

import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { channelFor, consentOf, type Channel } from "@/lib/messaging/consent";
import { CONSENT_COLUMNS, previewTemplate, sendStaffMessage } from "@/lib/messaging/send";

export type MovedMessage = {
  appointmentId: string;
  clientName: string;
  firstName: string;
  phone: string | null;
  // The channel they allow for messages about visits (null: call them).
  channel: Channel | null;
  subject: string;
  body: string;
  // Sent already, since the fix was applied.
  sent: boolean;
};

// askDefault: the answer the salon's "Let … know?" leans to (Settings →
// Messages); it only orders the buttons.
export type MovedMessages = { messages: MovedMessage[]; freeText: boolean; askDefault: "send" | "skip" };

async function desk() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && canBook(me.role) ? { supabase, me } : null;
}

export async function movedMessages(appointmentIds: string[], since: string): Promise<MovedMessages> {
  const s = await desk();
  const ids = Array.isArray(appointmentIds) ? appointmentIds.filter(isUuid).slice(0, 20) : [];
  if (!s || !ids.length || Number.isNaN(Date.parse(since))) return { messages: [], freeText: false, askDefault: "send" };
  const [{ data: visits }, { data: sent }, { data: business }] = await Promise.all([
    s.supabase.from("appointments").select(`id, client:clients(first_name, last_name, ${CONSENT_COLUMNS})`).in("id", ids),
    s.supabase.from("client_messages").select("appointment_id").in("appointment_id", ids).gte("created_at", since),
    s.supabase.from("businesses").select("free_text_roles, move_message_default").eq("id", s.me.business_id).maybeSingle(),
  ]);
  const done = new Set((sent ?? []).map((m) => m.appointment_id));
  const messages: MovedMessage[] = [];
  for (const id of ids) {
    const visit = visits?.find((v) => v.id === id);
    if (!visit?.client) continue;
    const channel = channelFor(consentOf(visit.client), "appointment")?.channel ?? null;
    const rendered = await previewTemplate(s.supabase, { appointmentId: id, template: "visit_moved", channel: channel ?? "sms" });
    if (!rendered) continue;
    messages.push({
      appointmentId: id,
      clientName: `${visit.client.first_name} ${visit.client.last_name ?? ""}`.trim(),
      firstName: visit.client.first_name,
      phone: visit.client.phone,
      channel,
      ...rendered,
      sent: done.has(id),
    });
  }
  return {
    messages,
    freeText: s.me.role === "owner" || Boolean(business?.free_text_roles.includes(s.me.role)),
    askDefault: business?.move_message_default === "skip" ? "skip" : "send",
  };
}

// Sends one client their message: the template as it is, or what the staff
// member wrote instead (for the roles the owner allows).
export async function sendMovedMessage(input: { appointmentId: string; channel: Channel; edited: string | null; subject: string }): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const s = await desk();
  if (!s) return { ok: false, message: "Only owners, managers and front desk can message clients about a move." };
  if (!isUuid(input.appointmentId)) return { ok: false, message: "Choose the visit again." };
  const result = await sendStaffMessage(s.supabase, {
    appointmentId: input.appointmentId,
    purpose: "appointment",
    template: input.edited ? "custom" : "visit_moved",
    channel: input.channel,
    body: input.edited ?? undefined,
    subject: input.subject,
  });
  return result.ok ? { ok: true, message: `Sent by ${result.channel === "sms" ? "text" : "email"}.` } : result;
}
