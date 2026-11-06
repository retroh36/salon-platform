"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { checkboxClass, fieldClass } from "@/components/ui/field";
import { formatDuration } from "@/lib/duration";
import { MAX_STEPS, STEP_NAME_MAX, stepsProblem, STEPS_PROBLEM_TEXT, stepsTiming, type Step } from "@/lib/scheduling/steps";

type Row = { key: number; name: string; minutes: string; processing: boolean };

let nextKey = 0;
const row = (name: string, minutes: string, processing: boolean): Row => ({ key: nextKey++, name, minutes, processing });

// A starting list from the three parts: the service, processing, finishing.
export function startingSteps(active: string, processing: string, finishing: string): Step[] {
  const n = (v: string) => Math.max(0, Number(v) || 0);
  if (n(processing) > 0) return [{ name: "Service", minutes: n(active) || 30, processing: false }, { name: "Processing", minutes: n(processing), processing: true }, { name: "Finish", minutes: n(finishing) || 15, processing: false }];
  return [{ name: "Service", minutes: n(active) || 30, processing: false }, { name: "Finish", minutes: 15, processing: false }];
}

// The steps a service is built from, as a list: a name, minutes and whether
// it's processing (the stylist free). Sent with the form as JSON in `steps`.
export function StepsEditor({ initial, error }: { initial: Step[]; error?: string }) {
  const [rows, setRows] = useState(() => initial.map((s) => row(s.name, String(s.minutes), s.processing)));
  const steps: Step[] = rows.map((r) => ({ name: r.name, minutes: Number(r.minutes), processing: r.processing }));
  const problem = stepsProblem(steps);
  const totals = stepsTiming(steps.filter((s) => Number.isFinite(s.minutes)));
  const total = steps.reduce((sum, s) => sum + (Number.isFinite(s.minutes) ? s.minutes : 0), 0);

  const change = (key: number, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: -1 | 1) =>
    setRows((all) => {
      const next = [...all];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      <ol aria-label="Steps" className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={r.key} data-testid="service-step" className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
            <span className="w-5 text-13 text-ink-muted tabular-nums">{i + 1}</span>
            <input
              aria-label={`Step ${i + 1} name`}
              value={r.name}
              maxLength={STEP_NAME_MAX}
              onChange={(e) => change(r.key, { name: e.target.value })}
              className={`${fieldClass} min-w-32 flex-1`}
            />
            <label className="flex items-center gap-1.5 text-13 text-ink-muted">
              <input
                aria-label={`Step ${i + 1} minutes`}
                type="number"
                min={5}
                step={5}
                value={r.minutes}
                onChange={(e) => change(r.key, { minutes: e.target.value })}
                className={`${fieldClass} w-20!`}
              />
              min
            </label>
            <label className="flex items-center gap-1.5 text-13 text-ink">
              <input type="checkbox" checked={r.processing} onChange={(e) => change(r.key, { processing: e.target.checked })} className={checkboxClass} />
              Processing
            </label>
            <span className="ml-auto flex items-center">
              <button type="button" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} className={buttonClass("ghost", "sm")}>
                ↑
              </button>
              <button type="button" aria-label={`Move step ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} className={buttonClass("ghost", "sm")}>
                ↓
              </button>
              <button type="button" aria-label={`Remove step ${i + 1}`} disabled={rows.length <= 2} onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} className={buttonClass("ghost", "sm")}>
                ×
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={rows.length >= MAX_STEPS} onClick={() => setRows((all) => [...all, row("", "15", false)])} className={buttonClass("secondary", "sm")}>
          Add a step
        </button>
        <button type="button" disabled={rows.length >= MAX_STEPS} onClick={() => setRows((all) => [...all.slice(0, -1), row("Processing", "20", true), ...all.slice(-1)])} className={buttonClass("secondary", "sm")}>
          Add processing
        </button>
      </div>
      <p data-testid="steps-total" className="text-13 text-ink-muted">
        {formatDuration(total)} in all
        {totals.processingMinutes > 0 && `, the stylist free for ${formatDuration(totals.processingMinutes)}`}.
      </p>
      {(error || (problem && problem !== "name")) && <p className="text-13 text-danger">{error ?? STEPS_PROBLEM_TEXT[problem!]}</p>}
    </div>
  );
}
