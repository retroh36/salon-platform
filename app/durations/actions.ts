"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentStaff } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { minutesText, visitsText } from "@/lib/insights/describe";
import type { DurationInsight } from "@/lib/insights/durations";
import { isUuid } from "@/lib/ids";
import { stretchTiming } from "@/lib/scheduling/booking";

export type DurationResult = { ok: true; message: string } | { ok: false; message: string };

const NOT_ALLOWED = "Only owners and managers can change stylists' lengths.";
const DURATION_FEATURE = "duration";

// Applies Denise's suggested length for a stylist and service: recorded in
// the AI action log (so it can be undone), worked out again here from
// what she's learned rather than taken from the browser.
export async function applySuggestedDuration(staffId: string, serviceId: string): Promise<DurationResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(staffId) || !isUuid(serviceId)) return { ok: false, message: "That suggestion no longer exists." };

  const [{ data: learned, error }, { data: service, error: serviceError }, { data: stylist, error: staffError }] = await Promise.all([
    supabase.from("insights").select("data").eq("business_id", me.business_id).eq("kind", "duration").eq("key", `${staffId}:${serviceId}`).maybeSingle(),
    supabase.from("services").select("name, active_minutes, processing_minutes, finishing_minutes").eq("id", serviceId).maybeSingle(),
    supabase.from("staff").select("first_name").eq("id", staffId).maybeSingle(),
  ]);
  if (error) throw error;
  if (serviceError) throw serviceError;
  if (staffError) throw staffError;
  const d = learned?.data as unknown as DurationInsight | undefined;
  if (!d?.suggestedMinutes || !service || !stylist) return { ok: false, message: "Denise has no suggestion for this any more." };

  const to = stretchTiming({ activeMinutes: service.active_minutes, processingMinutes: service.processing_minutes, finishingMinutes: service.finishing_minutes }, d.suggestedMinutes);
  const { data: ids, error: recordError } = await supabase.rpc("record_ai_proposals", {
    p_location_id: me.location.id,
    p_feature: DURATION_FEATURE,
    p_subject: `${DURATION_FEATURE}:${staffId}:${serviceId}`,
    p_options: [
      {
        summary: `Book ${service.name} with ${stylist.first_name} for ${minutesText(d.suggestedMinutes)}`,
        reason: `${stylist.first_name} takes ${minutesText(d.medianMinutes)} for ${service.name} (median of ${visitsText(d)}); the menu says ${minutesText(d.menuMinutes)}.`,
        proposal: { staff_service: { staff_id: staffId, service_id: serviceId, to: { active: to.activeMinutes, processing: to.processingMinutes, finishing: to.finishingMinutes } } } as Json,
      },
    ],
  });
  if (recordError?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (recordError) throw recordError;
  if (!ids.length) return { ok: false, message: "This suggestion was dismissed." };
  const { error: applyError } = await supabase.rpc("apply_duration_action", { p_action_id: ids[0] });
  if (applyError?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (applyError?.code === "55000") return { ok: false, message: applyError.message };
  if (applyError) throw applyError;
  revalidatePath("/durations");
  revalidatePath("/calendar", "layout");
  return { ok: true, message: `${stylist.first_name}'s ${service.name} now books for ${minutesText(d.suggestedMinutes)}.` };
}

export async function undoDuration(actionId: string): Promise<DurationResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(actionId)) return { ok: false, message: "That change no longer exists." };
  const { error } = await supabase.rpc("undo_duration_action", { p_action_id: actionId });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "55000") return { ok: false, message: error.message };
  if (error) throw error;
  revalidatePath("/durations");
  revalidatePath("/calendar", "layout");
  return { ok: true, message: "Back to the previous length." };
}
