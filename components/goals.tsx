import { DeniseFace } from "@/components/denise";
import { metricInfo, GOAL_PERIODS, type Pacing } from "@/lib/goals/pacing";
import { goalLine, goalValue, periodName, STATUS_LABELS } from "@/lib/goals/wording";
import type { GoalAlert } from "@/lib/goals/mine";
import { formatDay } from "@/lib/schedule-format";
import { formatPrice } from "@/lib/services";
import { AlertDismiss } from "./goal-controls";

const STATUS_CLASS = {
  hit: "bg-status-completed-bg text-status-completed-ink",
  ahead: "bg-status-completed-bg text-status-completed-ink",
  on_pace: "bg-status-confirmed-bg text-status-confirmed-ink",
  behind: "bg-status-late-bg text-status-late-ink",
} as const;

export function StatusPill({ status }: { status: Pacing["status"] }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[status]}`} data-testid="goal-status">
      {STATUS_LABELS[status]}
    </span>
  );
}

// One goal: what and when, a bar to the target, the numbers, and Denise's
// line (all from lib/goals).
export function GoalCard({ pacing, children }: { pacing: Pacing; children?: React.ReactNode }) {
  const p = pacing;
  const label = `${metricInfo(p.goal.metric).label} · ${GOAL_PERIODS.find((x) => x.value === p.goal.period)!.label.toLowerCase()} of ${p.goal.period === "week" ? formatDay(p.from) : periodName(p.goal.period, p.from)}`;
  const fill = Math.min(100, Math.max(0, p.percent));
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3" data-testid="goal" data-metric={p.goal.metric}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-ink">{label}</p>
        <StatusPill status={p.status} />
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fill}
        aria-valuetext={`${goalValue(p, p.current)} of ${goalValue(p, p.target)}`}
      >
        <div className={`h-full rounded-full ${p.status === "hit" ? "bg-status-completed-ink" : "bg-navy-700"}`} style={{ width: `${fill}%` }} />
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted tabular-nums">
        <div>
          <dt className="sr-only">Progress</dt>
          <dd data-testid="goal-progress">
            <span className="font-semibold text-ink">{goalValue(p, p.current)}</span> of {goalValue(p, p.target)}
          </dd>
        </div>
        {p.perDay ? (
          <div>
            <dt className="inline">Needed per working day: </dt>
            <dd className="inline" data-testid="goal-per-day">
              {metricInfo(p.goal.metric).unit === "cents" ? formatPrice(p.perDay) : p.perDay}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="inline">Working days left: </dt>
          <dd className="inline">{p.daysLeft}</dd>
        </div>
        {p.bookedAhead > 0 && (
          <div>
            <dt className="inline">Booked: </dt>
            <dd className="inline">{metricInfo(p.goal.metric).unit === "cents" ? formatPrice(p.bookedAhead) : p.bookedAhead}</dd>
          </div>
        )}
      </dl>
      <p className="text-sm text-ink" data-testid="goal-line">
        {goalLine(p)}
      </p>
      {children}
    </li>
  );
}

// Denise's goal alert: her line on each goal, any celebration, and what to
// do next. "Got it" puts it away until the next one is due.
export function GoalAlertCard({ alert, today }: { alert: GoalAlert; today: string }) {
  return (
    <section aria-label="Denise on your goals" className="mb-6 flex gap-3 rounded-xl border border-denise-200 bg-denise-50 p-4 text-denise-900" data-testid="goal-alert">
      <DeniseFace size={32} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {alert.celebrations.map((c) => (
          <p key={`${c.goalId}-${c.milestone}`} className="font-semibold" data-testid="goal-celebration">
            {c.text}
          </p>
        ))}
        <ul className="flex flex-col gap-1">
          {alert.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {alert.actions.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm" aria-label="Ideas from Denise" data-testid="goal-actions">
            {alert.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
        <AlertDismiss today={today} milestones={alert.celebrations.map((c) => ({ goalId: c.goalId, periodFrom: c.periodFrom, milestone: c.milestone }))} />
      </div>
    </section>
  );
}
