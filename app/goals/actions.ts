"use server";

// Goals: owners set them for anyone, anyone sets their own (the database
// checks who may, and that a stylist can't change one an owner set); how
// often Denise's goal alert comes up; and reading it.

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { GOAL_METRICS, GOAL_PERIODS, parseTarget, type AlertFrequency, type GoalMetric, type GoalPeriod } from "@/lib/goals/pacing";
import { isUuid } from "@/lib/ids";
import { isLocalDate } from "@/lib/scheduling/time";

export type GoalResult = { ok: true } | { ok: false; message: string };

function refresh() {
  revalidatePath("/my-day");
  revalidatePath("/dashboard");
  revalidatePath("/team/goals");
}

export async function saveGoal(input: { staffId: string; metric: string; period: string; target: string }): Promise<GoalResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { ok: false, message: "Sign in again." };
  if (!isUuid(input.staffId)) return { ok: false, message: "Choose who it's for." };
  if (!GOAL_METRICS.some((m) => m.value === input.metric)) return { ok: false, message: "Choose what the goal is for." };
  if (!GOAL_PERIODS.some((p) => p.value === input.period)) return { ok: false, message: "Choose a week, month, quarter or year." };
  const target = parseTarget(input.metric as GoalMetric, input.target);
  if (typeof target === "string") return { ok: false, message: target };
  const { error } = await supabase.rpc("save_staff_goal", { p_staff_id: input.staffId, p_metric: input.metric as GoalMetric, p_period: input.period as GoalPeriod, p_target: target });
  if (error?.code === "42501") return { ok: false, message: error.message === "An owner set this goal" ? "An owner set this goal, so only an owner can change it." : "Only owners set goals for others." };
  if (error?.code === "22023") return { ok: false, message: error.message };
  if (error) throw error;
  refresh();
  return { ok: true };
}

export async function deleteGoal(goalId: string): Promise<GoalResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(goalId)) return { ok: false, message: "That goal no longer exists." };
  const { error } = await supabase.rpc("delete_staff_goal", { p_goal_id: goalId });
  if (error?.code === "42501") return { ok: false, message: "An owner set this goal, so only an owner can remove it." };
  if (error) throw error;
  refresh();
  return { ok: true };
}

export async function setGoalAlerts(frequency: AlertFrequency): Promise<GoalResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || (frequency !== "daily" && frequency !== "weekly")) return { ok: false, message: "Choose daily or weekly." };
  const { error } = await supabase.rpc("set_goal_alerts", { p_frequency: frequency });
  if (error) throw error;
  refresh();
  return { ok: true };
}

export async function seenGoalAlert(today: string, milestones: { goalId: string; periodFrom: string; milestone: number }[]): Promise<GoalResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isLocalDate(today)) return { ok: false, message: "Sign in again." };
  const valid = milestones.filter((m) => isUuid(m.goalId) && isLocalDate(m.periodFrom) && [50, 75, 100].includes(m.milestone)).slice(0, 20);
  const { error } = await supabase.rpc("seen_goal_alert", { p_on: today, p_milestones: valid.map((m) => ({ goal_id: m.goalId, period_from: m.periodFrom, milestone: m.milestone })) });
  if (error) throw error;
  refresh();
  return { ok: true };
}
