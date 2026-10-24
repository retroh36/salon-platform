// A stylist's own goals for My day and their Dashboard: each paced for its
// period, and Denise's alert when it's due (daily or weekly, their choice)
// or a milestone hasn't been celebrated yet: a line per goal, the
// celebrations, and up to three things to do from real data.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardMe } from "@/lib/dashboard-load";
import type { Database } from "@/lib/database.types";
import { toLocal, type LocalDate } from "@/lib/scheduling/time";
import { loadGoalFacts } from "./facts";
import { loadGoals, paceGoals } from "./load";
import { alertDue, type AlertFrequency, type Pacing } from "./pacing";
import { celebration, goalActions, goalLine } from "./wording";

type Supabase = SupabaseClient<Database>;

export type GoalAlert = {
  lines: string[];
  celebrations: { text: string; goalId: string; periodFrom: LocalDate; milestone: 50 | 75 | 100 }[];
  actions: string[];
};

export type MyGoals = { today: LocalDate; frequency: AlertFrequency; pacings: (Pacing & { setByOwner: boolean })[]; alert: GoalAlert | null };

export async function loadMyGoals(supabase: Supabase, me: Pick<DashboardMe, "id" | "business_id" | "location">, now = new Date()): Promise<MyGoals> {
  const today = toLocal(now, me.location.timezone).date;
  const [goals, { data: staff, error }] = await Promise.all([
    loadGoals(supabase, me.business_id, me.id),
    supabase.from("staff").select("goal_alerts, goal_alert_seen_on").eq("id", me.id).single(),
  ]);
  if (error) throw error;
  const frequency = staff.goal_alerts as AlertFrequency;
  if (!goals.length) return { today, frequency, pacings: [], alert: null };
  const [mine] = await paceGoals(supabase, me, goals, now);
  const pacings = mine?.pacings ?? [];

  const { data: done, error: doneError } = await supabase.from("goal_celebrations").select("goal_id, period_from, milestone").in("goal_id", pacings.map((p) => p.goal.id));
  if (doneError) throw doneError;
  const celebrated = (p: Pacing) => Math.max(0, ...done.filter((d) => d.goal_id === p.goal.id && d.period_from === p.from).map((d) => d.milestone));
  const celebrations = pacings.flatMap((p) => (p.milestone > celebrated(p) ? [{ text: celebration(p)!, goalId: p.goal.id, periodFrom: p.from, milestone: p.milestone as 50 | 75 | 100 }] : []));

  if (!alertDue(frequency, staff.goal_alert_seen_on, today) && !celebrations.length) return { today, frequency, pacings, alert: null };
  const open = pacings.filter((p) => p.status !== "hit");
  const facts = open.length ? await loadGoalFacts(supabase, me, me.id, Math.max(0, ...pacings.map((p) => p.upcomingVisits)), now) : null;
  return { today, frequency, pacings, alert: { lines: pacings.map((p) => goalLine(p)), celebrations, actions: facts ? goalActions(pacings, facts) : [] } };
}
