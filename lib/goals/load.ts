// Loading goals and what pacing needs (worked out in ./pacing.ts): the
// goals (RLS: owners and managers see everyone's, others their own), the
// revenue behind them from payroll_sales (net of refunds and voids, as in
// payroll), rebooking, new clients and what's booked ahead from
// goal_progress, and working days from each person's schedule.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ticketsFor, type PayrollSale } from "@/lib/payroll";
import { dayView } from "@/lib/scheduling/availability";
import { loadLocationSchedule, loadStaffSchedules, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, datesBetween, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { goalPeriod, pace, workingDays, type Goal, type GoalMetric, type GoalPeriod, type Pacing, type Progress } from "./pacing";

type Supabase = SupabaseClient<Database>;

export type GoalRow = Goal & { setByOwner: boolean; staffName: string };
export type StaffGoals = { staffId: string; staffName: string; pacings: (Pacing & { setByOwner: boolean })[] };

type GoalProgress = { rebook: { visits: number; rebooked: number }; new_clients: number; ahead: { service_cents: number; visits: number; new_clients: number } };

export async function loadGoals(supabase: Supabase, businessId: string, staffId?: string): Promise<GoalRow[]> {
  let q = supabase.from("staff_goals").select("id, staff_id, metric, period, target, set_by_owner, staff:staff(first_name, last_name, is_active)").eq("business_id", businessId);
  if (staffId) q = q.eq("staff_id", staffId);
  const { data, error } = await q.order("created_at");
  if (error) throw error;
  return data
    .filter((g) => g.staff.is_active)
    .map((g) => ({ id: g.id, staffId: g.staff_id, metric: g.metric as GoalMetric, period: g.period as GoalPeriod, target: g.target, setByOwner: g.set_by_owner, staffName: `${g.staff.first_name} ${g.staff.last_name}`.trim() }));
}

// Each person's goals, paced for the current period of each.
export async function paceGoals(supabase: Supabase, me: { business_id: string; location: { id: string; timezone: string } }, goals: readonly GoalRow[], now = new Date()): Promise<StaffGoals[]> {
  if (!goals.length) return [];
  const tz = me.location.timezone;
  const local = toLocal(now, tz);
  const periods = new Map<GoalPeriod, { from: LocalDate; to: LocalDate }>();
  for (const g of goals) if (!periods.has(g.period)) periods.set(g.period, goalPeriod(g.period, local.date));
  const from = [...periods.values()].reduce((a, p) => (p.from < a ? p.from : a), local.date);
  const to = [...periods.values()].reduce((a, p) => (p.to > a ? p.to : a), local.date);
  const staffIds = [...new Set(goals.map((g) => g.staffId))];
  const [location, schedules] = await Promise.all([loadLocationSchedule(supabase, me.location), loadStaffSchedules(supabase, staffIds, from, to)]);

  // One look per person and period.
  const keys = [...new Set(goals.map((g) => `${g.staffId}|${g.period}`))];
  const measured = new Map<string, Progress>();
  await Promise.all(
    keys.map(async (key) => {
      const [staffId, kind] = key.split("|") as [string, GoalPeriod];
      const p = periods.get(kind)!;
      const start = startOfLocalDay(p.from, tz);
      const end = startOfLocalDay(addDays(p.to, 1), tz);
      const [sales, progress] = await Promise.all([
        supabase.rpc("payroll_sales", { p_business_id: me.business_id, p_from: start.toISOString(), p_to: end.toISOString(), p_staff_id: staffId }),
        supabase.rpc("goal_progress", { p_staff_id: staffId, p_from: start.toISOString(), p_to: end.toISOString() }),
      ]);
      if (sales.error) throw sales.error;
      if (progress.error) throw progress.error;
      const tickets = ticketsFor(sales.data as unknown as PayrollSale[], staffId, start, end);
      const g = progress.data as unknown as GoalProgress;
      const serviceCents = tickets.reduce((n, t) => n + t.serviceCents, 0);
      const retailCents = tickets.reduce((n, t) => n + t.retailCents, 0);
      // Tickets with something of theirs on them, less any voided since.
      const sold = tickets.filter((t) => t.kind === "sale" && t.lines.length > 0).length - tickets.filter((t) => t.kind === "void" && t.lines.length > 0).length;
      measured.set(key, {
        achieved: serviceCents,
        bookedAhead: g.ahead.service_cents,
        visits: g.rebook.visits,
        rebooked: g.rebook.rebooked,
        revenueCents: serviceCents + retailCents,
        tickets: Math.max(0, sold),
        upcomingVisits: g.ahead.visits,
        // Kept for the other measures below.
        ...({ retailCents, newClients: g.new_clients, newAhead: g.ahead.new_clients } as object),
      } as Progress);
    }),
  );

  const out = new Map<string, StaffGoals>();
  for (const g of goals) {
    const period = periods.get(g.period)!;
    const m = measured.get(`${g.staffId}|${g.period}`)! as Progress & { retailCents: number; newClients: number; newAhead: number };
    const progress: Progress =
      g.metric === "retail_revenue"
        ? { ...m, achieved: m.retailCents, bookedAhead: 0 }
        : g.metric === "new_clients"
          ? { ...m, achieved: m.newClients, bookedAhead: m.newAhead }
          : m;
    const schedule = schedules.get(g.staffId);
    const days = datesBetween(period.from, period.to).map((date) => ({ date, available: schedule ? dayView(schedule, location, date).available : [] }));
    const pacing = pace(g, period, progress, workingDays(days, local.date, local.minute));
    const entry = out.get(g.staffId) ?? { staffId: g.staffId, staffName: g.staffName, pacings: [] };
    entry.pacings.push({ ...pacing, setByOwner: g.setByOwner });
    out.set(g.staffId, entry);
  }
  return [...out.values()];
}
