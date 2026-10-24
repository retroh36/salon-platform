"use client";

import { useState, useTransition } from "react";
import { deleteGoal, saveGoal, seenGoalAlert, setGoalAlerts, type GoalResult } from "@/app/goals/actions";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { GOAL_METRICS, GOAL_PERIODS, metricInfo, type AlertFrequency, type GoalMetric } from "@/lib/goals/pacing";

export function AlertDismiss({ today, milestones }: { today: string; milestones: { goalId: string; periodFrom: string; milestone: number }[] }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" className="self-start" disabled={pending} onClick={() => start(async () => void (await seenGoalAlert(today, milestones)))}>
      Got it
    </Button>
  );
}

// Set a goal (or change one: the same measure and period replaces it).
export function GoalForm({ staff, fixedStaffId }: { staff?: { id: string; name: string }[]; fixedStaffId?: string }) {
  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState(fixedStaffId ?? "");
  const [metric, setMetric] = useState<GoalMetric>("service_revenue");
  const [period, setPeriod] = useState("month");
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<GoalResult | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <div className="flex flex-col gap-1">
        <Button size="sm" className="self-start" onClick={() => (setOpen(true), setResult(null))}>
          Set a goal
        </Button>
        {result?.ok && (
          <p role="status" className="text-sm text-ink-muted">
            Goal saved.
          </p>
        )}
      </div>
    );
  const unit = metricInfo(metric).unit;
  return (
    <form
      aria-label="Set a goal"
      className="flex flex-col gap-3 rounded-lg border border-line bg-sunken/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveGoal({ staffId, metric, period, target });
          setResult(r);
          if (r.ok) {
            setOpen(false);
            setTarget("");
          }
        });
      }}
    >
      {staff && (
        <label className={labelClass}>
          For
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} required className={selectClass}>
            <option value="">Choose a stylist</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Goal
          <select value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)} className={selectClass}>
            {GOAL_METRICS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Each
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={selectClass}>
            {GOAL_PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          {unit === "cents" ? "Target ($)" : unit === "percent" ? "Target (%)" : "Target"}
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" required className={fieldClass} placeholder={unit === "cents" ? "9000" : unit === "percent" ? "70" : "8"} />
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          Save goal
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Not now
        </Button>
      </div>
      {result && !result.ok && (
        <p role="alert" className="text-sm text-danger">
          {result.message}
        </p>
      )}
    </form>
  );
}

export function RemoveGoal({ goalId, label }: { goalId: string; label: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Remove ${label}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await deleteGoal(goalId);
            setMessage(r.ok ? null : r.message);
          })
        }
      >
        Remove
      </Button>
      {message && (
        <span role="alert" className="text-sm text-danger">
          {message}
        </span>
      )}
    </span>
  );
}

export function AlertFrequencyPicker({ value }: { value: AlertFrequency }) {
  const [current, setCurrent] = useState(value);
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm text-ink-muted">
      <span className="whitespace-nowrap">Denise&rsquo;s goal check-ins</span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value as AlertFrequency;
          setCurrent(v);
          start(async () => void (await setGoalAlerts(v)));
        }}
        className={`${selectClass} w-auto`}
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
      </select>
    </label>
  );
}
