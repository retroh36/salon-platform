import Link from "next/link";
import { GoalAlertCard, StatusPill } from "@/components/goals";
import { Card, textLinkClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import type { DashboardMe } from "@/lib/dashboard-load";
import { loadMyGoals } from "@/lib/goals/mine";
import { metricInfo } from "@/lib/goals/pacing";
import { goalValue } from "@/lib/goals/wording";

// A stylist's goals on their Dashboard: Denise's alert when it's due, and
// each goal at a glance (the full view and settings are on My day).
export async function GoalSection({ me }: { me: DashboardMe }) {
  const { supabase } = await getCurrentStaff();
  const goals = await loadMyGoals(supabase, me);
  if (!goals.pacings.length) return null;
  return (
    <div data-testid="dashboard-goals">
      {goals.alert && <GoalAlertCard alert={goals.alert} today={goals.today} />}
      <Card
        title="My goals"
        titleId="dashboard-goals-heading"
        actions={
          <Link href="/my-day#goals-heading" className={`text-sm ${textLinkClass}`}>
            See all on My day
          </Link>
        }
        flush
      >
        <ul className="flex flex-col divide-y divide-line">
          {goals.pacings.map((p) => (
            <li key={p.goal.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium text-ink">
                {metricInfo(p.goal.metric).label} <span className="font-normal text-ink-muted">· this {p.goal.period}</span>
              </span>
              <span className="flex items-center gap-3 text-ink-muted tabular-nums">
                {goalValue(p, p.current)} of {goalValue(p, p.target)}
                <StatusPill status={p.status} />
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
