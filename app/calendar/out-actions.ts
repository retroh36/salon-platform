"use server";

// Marking a stylist out, from the calendar's panel (./out-panel.tsx): the
// plan for their clients for a time out (all day, leaving early, coming in
// late) before anything is saved, marking them out, applying the reviewed
// plan for all their clients at once through the AI action log (one
// transaction, logged, with Undo), and messaging each client from our
// templates (or the staff member's own words) through the consent rules.
// Front of house only, except that stylists can mark themselves out.

import { revalidatePath } from "next/cache";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { failureMessage } from "@/lib/denise/fixes";
import { describeProblem } from "@/lib/scheduling/booking";
import { isUuid } from "@/lib/ids";
import { channelFor, consentOf, type Channel } from "@/lib/messaging/consent";
import { CONSENT_COLUMNS, previewRescue, previewTemplate, sendStaffMessage } from "@/lib/messaging/send";
import { messageFor, outWindow, type OutWhen, type RescueChoice } from "@/lib/rescue";
import { applyRescuePlan, type RescueMoveInput } from "@/lib/rescue-apply";
import { loadRescue, type RescuePlan } from "@/lib/rescue-load";
import { undoAction } from "@/lib/scheduling/ai-actions";
import { reportCallOut } from "@/lib/scheduling/disruptions";
import { addDays, isLocalDate, todayIn } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";

const NOT_ALLOWED = "Only owners, managers and front desk can move clients.";

async function desk() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && canBook(me.role) ? { supabase, me } : null;
}

type Result = { ok: true; message: string } | { ok: false; message: string };

export type OutPanelData = {
  plan: RescuePlan;
  messages: (RescueMessage & { clientName: string })[];
  freeText: boolean;
};

// Everything the panel shows for a stylist on a day: if they're marked out,
// the plan for that time out (or, once applied, each client's message);
// if not yet, the plan for `when`, with nothing saved.
export async function loadOutPanel(staffId: string, date: string, when: OutWhen): Promise<OutPanelData | null> {
  const s = await desk();
  if (!s || !isUuid(staffId) || !isLocalDate(date)) return null;
  const tz = s.me.location.timezone;
  if (date < todayIn(tz) || date > addDays(todayIn(tz), 366)) return null;
  const span = outWindow(date, when, tz);
  if (!span) return null;
  const [plan, business] = await Promise.all([
    loadRescue(s.supabase, s.me.location, s.me.business_id, staffId, date, new Date(), span),
    s.supabase.from("businesses").select("free_text_roles").eq("id", s.me.business_id).single(),
  ]);
  if (!plan) return null;
  const freeText = s.me.role === "owner" || Boolean(business.data?.free_text_roles.includes(s.me.role));
  if (!plan.applied) return { plan, messages: [], freeText };
  const [messages, { data: visits }] = await Promise.all([
    rescueMessages(staffId, plan.applied.lines, plan.applied.at),
    s.supabase.from("appointments").select("id, client:clients(first_name, last_name)").in("id", plan.applied.lines.map((l) => l.appointmentId)),
  ]);
  const names = new Map((visits ?? []).flatMap((a) => (a.client ? [[a.id, fullName(a.client)] as const] : [])));
  return { plan, messages: messages.map((m) => ({ ...m, clientName: names.get(m.appointmentId) ?? "Client" })), freeText };
}

// Marks the stylist out on that day (the front of house anyone, a stylist
// themselves): approved time off for the time out, and a call-out.
export async function markOut(staffId: string, date: string, when: OutWhen): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || (!canBook(me.role) && me.id !== staffId)) return { ok: false, message: "Only owners, managers and front desk can mark someone else out." };
  if (!isUuid(staffId) || !isLocalDate(date)) return { ok: false, message: "Choose the stylist and day again." };
  const tz = me.location.timezone;
  if (date < todayIn(tz)) return { ok: false, message: "That day is over." };
  const span = outWindow(date, when, tz);
  if (!span) return { ok: false, message: when.kind === "late" ? "Give the time they come in, like 11:00am." : "Give the time they leave, like 1:00pm." };
  const result = await reportCallOut(supabase, staffId, span.from, span.until);
  if (!result.ok) return { ok: false, message: result.error === "forbidden" ? "Only owners, managers and front desk can mark someone else out." : "That didn't work. Try again." };
  revalidatePath("/calendar", "layout");
  return { ok: true, message: "Marked out." };
}

// Marks them out (if they aren't yet) and applies every chosen move at
// once (lib/rescue-apply.ts): all or nothing. If the moves can't be made,
// they stay marked out and the panel says why.
export async function applyRescue(staffId: string, date: string, when: OutWhen, moves: RescueMoveInput[]): Promise<Result & { actionId?: string; markedOut?: boolean }> {
  const s = await desk();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const marked = await markOut(staffId, date, when);
  if (!marked.ok) return marked;
  const result = await applyRescuePlan(s.supabase, createAdminClient(), s.me.location, s.me.business_id, staffId, date, moves);
  if (!result.ok) {
    revalidatePath("/calendar", "layout");
    return { ...result, markedOut: true };
  }
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
  // Sent already, since the plan was applied.
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
