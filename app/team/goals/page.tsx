import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { GoalForm, RemoveGoal } from "@/components/goal-controls";
import { StatusPill } from "@/components/goals";
import { Card, EmptyState, PageHeader } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { loadGoals, paceGoals } from "@/lib/goals/load";
import { metricInfo } from "@/lib/goals/pacing";
import { goalLine, goalValue, periodName } from "@/lib/goals/wording";
import { formatPrice } from "@/lib/services";
import { fullName } from "@/lib/staff";
import { TeamTabs } from "../team-tabs";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Team goals" };

export default function TeamGoalsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <TeamGoals />
    </Suspense>
  );
}

// Owners and managers: every stylist's goals, paced for this period, with
// what each needs per working day. Owners set and remove them.
async function TeamGoals() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!canManage(me.role)) redirect("/team");
  const [goals, { data: stylists, error }] = await Promise.all([
    loadGoals(supabase, me.business_id),
    supabase.from("staff").select("id, first_name, last_name").eq("business_id", me.business_id).eq("role", "stylist").eq("is_active", true).order("first_name"),
  ]);
  if (error) throw error;
  const paced = new Map((await paceGoals(supabase, me, goals)).map((s) => [s.staffId, s.pacings]));
  const owner = can(me, "team");

  return (
    <AppShell section="team" me={me}>
      <PageHeader title="Team" description="Each stylist's goals for this week, month, quarter or year, and how they're pacing. Stylists can set their own on My day." />
      <TeamTabs current="goals" goals />
      {owner && (
        <Card title="Set a goal" titleId="set-goal-heading" description="Service revenue, retail, rebooking %, new clients or average ticket, for each week, month, quarter or year. The same goal and period again changes the target.">
          <GoalForm staff={stylists.map((s) => ({ id: s.id, name: fullName(s) }))} />
        </Card>
      )}
      <Card title="Goals" titleId="team-goals-heading" flush>
        {stylists.length === 0 ? (
          <div className="p-5">
            <EmptyState>No stylists yet.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {stylists.map((s) => {
              const pacings = paced.get(s.id) ?? [];
              return (
                <li key={s.id} className="px-5 py-4" data-testid="team-goal-row" data-staff-id={s.id}>
                  <p className="mb-2 font-semibold text-ink">{fullName(s)}</p>
                  {pacings.length === 0 ? (
                    <p className="text-sm text-ink-muted">No goals.</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {pacings.map((p) => (
                        <li key={p.goal.id} className="flex flex-col gap-1 text-sm" data-testid="team-goal" data-metric={p.goal.metric}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">
                              {metricInfo(p.goal.metric).label} · {p.goal.period === "week" ? "this week" : periodName(p.goal.period, p.from)}
                              <span className="font-normal text-ink-muted tabular-nums">
                                {" "}
                                · {goalValue(p, p.current)} of {goalValue(p, p.target)}
                                {p.perDay ? ` · ${metricInfo(p.goal.metric).unit === "cents" ? formatPrice(p.perDay) : p.perDay}/day for ${p.daysLeft} ${p.daysLeft === 1 ? "day" : "days"}` : ""}
                              </span>
                            </span>
                            <span className="flex items-center gap-2">
                              <StatusPill status={p.status} />
                              {owner && <RemoveGoal goalId={p.goal.id} label={`${s.first_name}'s ${metricInfo(p.goal.metric).label.toLowerCase()} goal`} />}
                            </span>
                          </div>
                          <p className="text-ink-muted">{goalLine(p, s.first_name)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
