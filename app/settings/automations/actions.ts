"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { AUTOMATION_KINDS, automationProblems, type AutomationKind, type AutomationSettings } from "@/lib/automations";
import { runAutomations, type RunSummary } from "@/lib/automations-run";
import { isUuid } from "@/lib/ids";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";

export type Result = { ok: true; message: string } | { ok: false; message: string };

const URL = /^https:\/\/[^\s]{4,500}$/;

export async function saveAutomation(
  kind: AutomationKind,
  input: { enabled: boolean; subject: string; body: string; settings: AutomationSettings; googleUrl?: string; yelpUrl?: string },
): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers can change automations." };
  if (!AUTOMATION_KINDS.includes(kind)) return { ok: false, message: "That automation doesn't exist." };
  const googleUrl = input.googleUrl?.trim() ?? "";
  const yelpUrl = input.yelpUrl?.trim() ?? "";
  if ((googleUrl && !URL.test(googleUrl)) || (yelpUrl && !URL.test(yelpUrl))) return { ok: false, message: "Review links start with https://." };
  const { data: b } = await supabase.from("businesses").select("slug, google_review_url, yelp_url, online_booking_settings(enabled)").eq("id", me.business_id).single();
  const salon = {
    bookingLive: Boolean(b?.slug && b.online_booking_settings?.enabled),
    googleUrl: kind === "review" ? googleUrl || null : (b?.google_review_url ?? null),
    yelpUrl: kind === "review" ? yelpUrl || null : (b?.yelp_url ?? null),
  };
  const settings: AutomationSettings = { ...input.settings, prefer: input.settings.prefer === "email" ? "email" : "sms" };
  const problems = automationProblems({ kind, subject: input.subject, body: input.body, settings }, salon);
  // Saved off with problems (as a draft) is fine; on, it has to be right.
  if (input.enabled && problems.length) return { ok: false, message: problems[0] };
  if (problems.some((p) => p.startsWith("These aren't fields") || p.startsWith("Keep"))) return { ok: false, message: problems.find((p) => p.startsWith("These aren't fields") || p.startsWith("Keep"))! };
  const { error } = await supabase.rpc("save_automation", {
    p_business_id: me.business_id,
    p_kind: kind,
    p_input: { enabled: input.enabled, subject: input.subject.trim(), body: input.body.trim(), settings, ...(kind === "review" ? { google_review_url: googleUrl, yelp_url: yelpUrl } : {}) } as never,
  });
  if (error) return { ok: false, message: error.code === "42501" ? "Only owners and managers can change automations." : "That didn't save. Try again." };
  revalidatePath("/settings/automations");
  return { ok: true, message: input.enabled ? "Saved. It's on." : "Saved. It's off." };
}

// Messages due now, for this salon (the hourly job does the same).
export async function sendDueNow(): Promise<{ ok: true; summary: RunSummary } | { ok: false; message: string }> {
  const { staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers can send messages now." };
  const summary = await runAutomations(createAdminClient(), { businessId: me.business_id });
  revalidatePath("/settings/automations");
  return { ok: true, summary };
}

// Denise's suggestion to turn one on: an owner approves it (through the AI
// action log, so it can be undone), or says not now (she won't suggest it
// again).
export async function decideSuggestion(actionId: string, decision: "apply" | "reject" | "undo"): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings") || !isUuid(actionId)) return { ok: false, message: "Only owners and managers can turn automations on." };
  const fn = decision === "apply" ? "apply_automation_action" : decision === "undo" ? "undo_automation_action" : "reject_ai_action";
  const { error } = await supabase.rpc(fn, { p_action_id: actionId });
  if (error) return { ok: false, message: ["42501", "55000", "P0002"].includes(error.code ?? "") ? error.message : "That didn't work. Try again." };
  revalidatePath("/settings/automations");
  return { ok: true, message: decision === "apply" ? "Turned on." : decision === "undo" ? "Turned back off." : "Okay, I won't suggest it again." };
}
