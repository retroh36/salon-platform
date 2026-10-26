// Applying a sick-day rescue (server): the moves staff reviewed on
// /calendar/rescue, checked and saved through the AI action log.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { failureMessage } from "@/lib/denise/fixes";
import { describeProblem } from "@/lib/scheduling/booking";
import { isUuid } from "@/lib/ids";
import { loadDurations, usualTimings } from "@/lib/insights/read";
import { coverNotice } from "@/lib/rescue";
import { loadCallOut, rescueSubject } from "@/lib/rescue-load";
import { applyAction, recordProposals, type ItemChange, type NotificationDraft } from "@/lib/scheduling/ai-actions";
import { loadBookingContext } from "@/lib/scheduling/load";
import { RESCHEDULE_DAYS } from "@/lib/scheduling/rescue";
import { addDays, isLocalDate, todayIn } from "@/lib/scheduling/time";

type Supabase = SupabaseClient<Database>;
type Result = { ok: true; message: string; actionId: string } | { ok: false; message: string };

export type RescueMoveInput = { appointmentId: string; itemId: string; staffId: string; resourceId: string | null; start: string };

// Applies every chosen move at once, as the signed-in staff member
// (`supabase`; `server` is the service role, for recording the notices).
// The lengths are worked out here (a new stylist's usual time for the
// service, else the booked one), the covering stylists get a notice in the
// app, and the call-out is marked dealt with. All or nothing: one action
// in the log, applied in one transaction, so if any move no longer fits,
// nothing moves.
export async function applyRescuePlan(
  supabase: Supabase,
  server: Supabase,
  location: { id: string; timezone: string },
  businessId: string,
  staffId: string,
  date: string,
  moves: RescueMoveInput[],
): Promise<Result> {
  if (!isUuid(staffId) || !isLocalDate(date) || !Array.isArray(moves) || moves.length === 0 || moves.length > 200) return { ok: false, message: "Choose at least one change." };
  if (moves.some((m) => !isUuid(m.itemId) || !isUuid(m.appointmentId) || !isUuid(m.staffId) || (m.resourceId !== null && !isUuid(m.resourceId)) || Number.isNaN(Date.parse(m.start)))) {
    return { ok: false, message: "Something in the plan isn't right. Reload and try again." };
  }
  const out = await loadCallOut(supabase, location, staffId, date);
  if (!out) return { ok: false, message: "Mark them out first." };

  const { data: items, error } = await supabase
    .from("appointment_items")
    .select("id, appointment_id, service_id, staff_id, resource_id, starts_at, active_minutes, processing_minutes, finishing_minutes, service:services(name), appointment:appointments(client:clients(first_name))")
    .in("id", moves.map((m) => m.itemId));
  if (error) throw error;
  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  // Only visits with this stylist that day.
  const touched = new Set(moves.map((m) => m.appointmentId));
  const { data: theirs } = await supabase.from("appointment_items").select("appointment_id").eq("staff_id", staffId).in("appointment_id", [...touched]);
  const ok = new Set((theirs ?? []).map((t) => t.appointment_id));
  if (moves.some((m) => !byId.get(m.itemId) || byId.get(m.itemId)!.appointment_id !== m.appointmentId || !ok.has(m.appointmentId))) {
    return { ok: false, message: "The calendar changed since this plan was made. Reload to see it again." };
  }

  const [ctx, learned, names] = await Promise.all([
    loadBookingContext(supabase, location, date, addDays(date, RESCHEDULE_DAYS)),
    loadDurations(supabase, businessId),
    supabase.from("staff").select("id, first_name").eq("location_id", location.id),
  ]);
  const { timingOf } = usualTimings(ctx, learned);
  const absentName = names.data?.find((n) => n.id === staffId)?.first_name ?? "Their stylist";
  const today = todayIn(location.timezone);
  const facts = { tz: location.timezone, date, absentName, names: new Map(), levels: new Map(), services: new Map(), priceOf: () => null };

  const changes: ItemChange[] = [];
  const notifications: NotificationDraft[] = [];
  const undoNotifications: NotificationDraft[] = [];
  for (const m of moves) {
    const item = byId.get(m.itemId)!;
    const own = { activeMinutes: item.active_minutes, processingMinutes: item.processing_minutes, finishingMinutes: item.finishing_minutes };
    const newStylist = m.staffId !== item.staff_id;
    const timing = newStylist && m.staffId !== staffId ? (timingOf(m.staffId, item.service_id) ?? own) : own;
    const start = new Date(m.start);
    changes.push({
      itemId: item.id,
      appointmentId: item.appointment_id,
      from: { staffId: item.staff_id, resourceId: item.resource_id, start: new Date(item.starts_at) },
      to: { staffId: m.staffId, resourceId: m.resourceId, start },
      timing,
    });
    if (newStylist && m.staffId !== staffId) {
      const notice = coverNotice(facts, { staffId: m.staffId, start }, item.appointment?.client?.first_name ?? null, item.service?.name ?? "visit", today);
      notifications.push({ appointmentId: item.appointment_id, staffId: m.staffId, channel: "app", template: "staff_covering", body: notice.body });
      undoNotifications.push({ appointmentId: item.appointment_id, staffId: m.staffId, channel: "app", template: "staff_covering_undone", body: notice.undo });
    }
  }

  const clients = new Set((items ?? []).map((i) => i.appointment_id)).size;
  let actionId: string;
  try {
    [actionId] = await recordProposals(
      supabase,
      location.id,
      {
        feature: "rescue",
        subject: rescueSubject(staffId, date) + crypto.randomUUID(),
        options: [
          {
            summary: `${absentName} out ${out.text}: ${clients} ${clients === 1 ? "client" : "clients"} moved`,
            reason: "Reviewed and applied by the front desk.",
            proposal: { changes, notifications, undoNotifications, resolves: [out.disruptionId] },
          },
        ],
      },
      { server },
    );
    if (!actionId) throw new Error("The rescue wasn't recorded.");
  } catch (e) {
    if ((e as { code?: string }).code === "42501") return { ok: false, message: "Only owners, managers and front desk can move clients." };
    throw e;
  }
  const result = await applyAction(supabase, location, actionId);
  if (!result.ok) {
    await supabase.rpc("reject_ai_action", { p_action_id: actionId });
    const message = result.error === "invalid" ? `Nothing was moved: ${[...new Set(result.problems.map(describeProblem))].join(" ")} Reload to see the plan again.` : failureMessage(result);
    return { ok: false, message };
  }
  return { ok: true, actionId, message: `${clients} ${clients === 1 ? "client" : "clients"} moved.` };
}

