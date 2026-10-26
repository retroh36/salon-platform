"use server";

// Sick-day rescue (./page.tsx): mark a stylist out, apply the reviewed plan
// for all their clients at once through the AI action log (one transaction,
// logged, with Undo), and message each client from our templates (or the
// staff member's own words) through the consent rules. Front of house only.

import { revalidatePath } from "next/cache";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { failureMessage } from "@/lib/denise/fixes";
import { describeProblem } from "@/lib/scheduling/booking";
import { isUuid } from "@/lib/ids";
import { channelFor, consentOf, type Channel } from "@/lib/messaging/consent";
import { CONSENT_COLUMNS, previewRescue, previewTemplate, sendStaffMessage } from "@/lib/messaging/send";
import { messageFor, type RescueChoice } from "@/lib/rescue";
import { applyRescuePlan, type RescueMoveInput } from "@/lib/rescue-apply";
import { undoAction } from "@/lib/scheduling/ai-actions";
import { reportCallOut } from "@/lib/scheduling/disruptions";
import { fromLocal, isLocalDate, parseTime, todayIn } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";

const NOT_ALLOWED = "Only owners, managers and front desk can move clients.";

async function desk() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && canBook(me.role) ? { supabase, me } : null;
}

type Result = { ok: true; message: string } | { ok: false; message: string };

// Marks the stylist out on that day: all day, or from a time ("13:00").
export async function markOut(staffId: string, date: string, from: string | null): Promise<Result> {
  const s = await desk();
  if (!s) return { ok: false, message: "Only owners, managers and front desk can plan a rescue." };
  if (!isUuid(staffId) || !isLocalDate(date)) return { ok: false, message: "Choose the stylist and day again." };
  const tz = s.me.location.timezone;
  const today = todayIn(tz);
  if (date < today) return { ok: false, message: "That day is over." };
  const minute = from ? parseTime(from) : 0;
  if (minute === null) return { ok: false, message: "Give the time they leave, like 1:00pm." };
  const start = fromLocal(date, minute, tz)!;
  const result = await reportCallOut(s.supabase, staffId, start);
  if (!result.ok) return { ok: false, message: result.error === "forbidden" ? "Only owners, managers and front desk can mark someone else out." : "That didn't work. Try again." };
  revalidatePath("/calendar", "layout");
  return { ok: true, message: "Marked out." };
}

// Applies every chosen move at once (lib/rescue-apply.ts): all or nothing.
export async function applyRescue(staffId: string, date: string, moves: RescueMoveInput[]): Promise<Result & { actionId?: string }> {
  const s = await desk();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const result = await applyRescuePlan(s.supabase, createAdminClient(), s.me.location, s.me.business_id, staffId, date, moves);
  if (result.ok) revalidatePath("/calendar", "layout");
  return result;
}

// Puts every visit back where it was, if their places are still free.
export async function undoRescue(actionId: string): Promise<Result> {
  const s = await desk();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(actionId)) return { ok: false, message: "That can't be undone." };
  const result = await undoAction(s.supabase, s.me.location, actionId);
  if (!result.ok) {
    if (result.error === "invalid") return { ok: false, message: `It can't be undone: ${[...new Set(result.problems.map(describeProblem))].join(" ")}` };
    if (result.error === "stale") return { ok: false, message: "Something it moved has changed since, so it can't be undone." };
    return { ok: false, message: failureMessage(result) };
  }
  revalidatePath("/calendar", "layout");
  return { ok: true, message: "Everyone is back where they were." };
}

export type RescueMessage = {
  appointmentId: string;
  template: "stylist_out_covered" | "stylist_out_moved" | "need_to_move";
  channel: Channel | null;
  subject: string;
  body: string;
  // Sent already for this rescue.
  sent: boolean;
};

// The message for each client, as their visit is now: by the channel they
// allow for messages about visits (null: call them).
export async function rescueMessages(staffId: string, lines: { appointmentId: string; kind: RescueChoice["kind"] }[], since: string | null): Promise<RescueMessage[]> {
  const s = await desk();
  if (!s || !isUuid(staffId) || !Array.isArray(lines)) return [];
  const ids = lines.map((l) => l.appointmentId).filter(isUuid);
  if (!ids.length) return [];
  const [{ data: visits }, { data: sent }] = await Promise.all([
    s.supabase.from("appointments").select(`id, client:clients(${CONSENT_COLUMNS})`).in("id", ids),
    since
      ? s.supabase.from("client_messages").select("appointment_id").in("appointment_id", ids).gte("created_at", since)
      : Promise.resolve({ data: [] as { appointment_id: string | null }[] }),
  ]);
  const done = new Set((sent ?? []).map((m) => m.appointment_id));
  const out: RescueMessage[] = [];
  for (const l of lines) {
    const template = messageFor(l.kind);
    const visit = visits?.find((v) => v.id === l.appointmentId);
    if (!template || !visit?.client) continue;
    const channel = channelFor(consentOf(visit.client), "appointment")?.channel ?? null;
    const shown = channel ?? "sms";
    const rendered =
      template === "need_to_move"
        ? await previewTemplate(s.supabase, { appointmentId: l.appointmentId, template, channel: shown })
        : await previewRescue(s.supabase, { appointmentId: l.appointmentId, template, channel: shown, absentStaffId: staffId });
    if (!rendered) continue;
    out.push({ appointmentId: l.appointmentId, template, channel, subject: rendered.subject, body: rendered.body, sent: done.has(l.appointmentId) });
  }
  return out;
}

// Sends one client their message: the template as it is, or what the staff
// member wrote instead (for the roles the owner allows).
export async function sendRescueMessage(input: { appointmentId: string; staffId: string; template: RescueMessage["template"]; channel: Channel; edited: string | null; subject: string }): Promise<Result> {
  const s = await desk();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(input.appointmentId) || !isUuid(input.staffId)) return { ok: false, message: "Choose the visit again." };
  const result = await sendStaffMessage(s.supabase, {
    appointmentId: input.appointmentId,
    purpose: "appointment",
    template: input.edited ? "custom" : input.template,
    channel: input.channel,
    body: input.edited ?? undefined,
    subject: input.subject,
    absentStaffId: input.staffId,
  });
  return result.ok ? { ok: true, message: `Sent by ${result.channel === "sms" ? "text" : "email"}.` } : result;
}
