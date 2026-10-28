"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { DRAFT_FEATURE, draftMonth, nextMonth } from "@/lib/coverage";
import { loadCoverage } from "@/lib/coverage-load";
import type { Json } from "@/lib/database.types";
import { isUuid } from "@/lib/ids";
import { todayIn } from "@/lib/scheduling/time";

export type DraftResult = { ok: boolean; message: string };

const NOT_ALLOWED = "Only owners and managers can change the schedule.";

function refresh() {
  revalidatePath("/scheduling", "layout");
}

// Denise drafts next month from everyone's published hours (our code:
// `draftMonth`), and proposes it through the AI action log for an owner or
// manager to apply into the draft.
export async function draftNextMonth(): Promise<DraftResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role)) return { ok: false, message: NOT_ALLOWED };
  const { month, name, from, to } = nextMonth(todayIn(me.location.timezone));
  const coverage = await loadCoverage(supabase, me.location, from, to, { drafts: false });
  const { changes, filled, left } = draftMonth(coverage.people, coverage.days);

  // A new draft replaces one still waiting.
  const { data: waiting, error } = await supabase.from("ai_actions").select("id").eq("location_id", me.location.id).eq("feature", DRAFT_FEATURE).eq("status", "proposed");
  if (error) throw error;
  for (const w of waiting) {
    const r = await supabase.rpc("reject_ai_action", { p_action_id: w.id });
    if (r.error) throw r.error;
  }
  if (!changes.length) return { ok: true, message: left.length ? `${name} needs no changes I can make. ${left.length} gaps are left for you to fill.` : `${name} is covered as it is. Nothing to draft.` };

  const days = new Set(changes.map((c) => c.date)).size;
  const { error: recordError } = await supabase.rpc("record_ai_proposals", {
    p_location_id: me.location.id,
    p_feature: DRAFT_FEATURE,
    p_subject: `${DRAFT_FEATURE}:${month}:${Date.now()}`,
    p_options: [
      {
        summary: `A draft for ${name}: ${changes.length} ${changes.length === 1 ? "change" : "changes"} over ${days} ${days === 1 ? "day" : "days"}`,
        reason: `Everyone's usual hours, with approved time off taken out${filled.length ? `, and ${filled.length} front desk ${filled.length === 1 ? "gap" : "gaps"} covered` : ""}.`,
        proposal: {
          month,
          days: changes.map((c) => ({ staff_id: c.staffId, on_date: c.date, shifts: c.shifts })),
          filled: filled.map((f) => f.text),
          left: left.map((f) => f.text),
        },
      },
    ] as unknown as Json,
  });
  if (recordError) throw recordError;
  refresh();
  return { ok: true, message: `Here's a draft for ${name}.` };
}

export async function decideMonthDraft(id: string, decision: "apply" | "undo" | "dismiss"): Promise<DraftResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !canManage(me.role) || !isUuid(id)) return { ok: false, message: NOT_ALLOWED };
  const { error } =
    decision === "apply"
      ? await supabase.rpc("apply_schedule_draft_action", { p_action_id: id })
      : decision === "undo"
        ? await supabase.rpc("undo_schedule_draft_action", { p_action_id: id })
        : await supabase.rpc("reject_ai_action", { p_action_id: id });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "55000") return { ok: false, message: error.message };
  if (error) throw error;
  refresh();
  return {
    ok: true,
    message: decision === "apply" ? "Added to the draft. Each week changes for the team only when you publish it." : decision === "undo" ? "Taken back out of the draft." : "Dismissed.",
  };
}
