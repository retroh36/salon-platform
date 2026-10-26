"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert, listClass } from "@/components/ui/page";
import { MODE_LABELS, parsePlanInput, STYLE_LABELS, tierExample, type PayMode, type PlanInput, type TierStyle } from "@/lib/commission";
import { archiveCommissionPlan, saveCommissionPlan, setStaffPlan, type PlanResult } from "./actions";

type Rows = PlanInput["service"];

// Tiers as rows: "From $" (the first is always $0) and "%".
function TierRows({ label, rows, onChange }: { label: string; rows: Rows; onChange: (rows: Rows) => void }) {
  const set = (i: number, patch: Partial<Rows[number]>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink">{label}</legend>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-3">
          <label className={labelClass}>
            {i === 0 ? "From" : `Tier ${i + 1} from ($)`}
            {i === 0 ? (
              <span className="flex h-11 items-center text-sm text-ink-muted">$0</span>
            ) : (
              <input value={r.from} onChange={(e) => set(i, { from: e.target.value })} inputMode="decimal" className={`${fieldClass} w-32!`} />
            )}
          </label>
          <label className={labelClass}>
            {i === 0 ? `${label} %` : `Tier ${i + 1} %`}
            <input value={r.pct} onChange={(e) => set(i, { pct: e.target.value })} inputMode="decimal" className={`${fieldClass} w-24!`} />
          </label>
          {i > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${label.toLowerCase()} tier ${i + 1}`}>
              Remove
            </Button>
          )}
        </div>
      ))}
      {rows.length < 6 && (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => onChange([...rows, { from: "", pct: "" }])}>
          Add a {label.toLowerCase()} tier
        </Button>
      )}
    </fieldset>
  );
}

export function PlanEditor({ planId, initial }: { planId: string | null; initial: PlanInput }) {
  const [p, setP] = useState(initial);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [pending, start] = useTransition();
  const tiered = (p.mode === "commission" && p.service.length > 1) || p.retail.length > 1;
  // The preview, from the same calculation payroll uses (once the form reads).
  const parsed = parsePlanInput(p.name.trim() ? p : { ...p, name: "Preview" });
  const example = parsed.ok ? tierExample(parsed.rules) : null;
  return (
    <form
      aria-label={planId ? `Edit ${initial.name}` : "New plan"}
      className="flex max-w-2xl flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveCommissionPlan(planId, p);
          setResult(r);
          if (r.ok && !planId) setP(initial);
        });
      }}
    >
      <div className="flex flex-wrap gap-4">
        <label className={labelClass}>
          Plan name
          <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} maxLength={60} className={`${fieldClass} w-64!`} />
        </label>
        <label className={labelClass}>
          How they&rsquo;re paid
          <select value={p.mode} onChange={(e) => setP({ ...p, mode: e.target.value as PayMode })} className={`${selectClass} w-48!`}>
            {(Object.keys(MODE_LABELS) as PayMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {p.mode === "hourly" && <p className="text-sm text-ink-muted">Paid by the hour at each person&rsquo;s own rate (Team → Schedule), plus retail commission.</p>}
      {p.mode === "commission" && <TierRows label="Services" rows={p.service} onChange={(service) => setP({ ...p, service })} />}
      <TierRows label="Retail" rows={p.retail} onChange={(retail) => setP({ ...p, retail })} />
      {tiered && (
        <div className="flex flex-wrap items-end gap-4">
          <label className={labelClass}>
            How tiers pay
            <select value={p.tierStyle} onChange={(e) => setP({ ...p, tierStyle: e.target.value as TierStyle })} className={`${selectClass} w-96!`}>
              {(Object.keys(STYLE_LABELS) as TierStyle[]).map((k) => (
                <option key={k} value={k}>
                  {STYLE_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Tiers start again
            <select value={p.tierPeriod} onChange={(e) => setP({ ...p, tierPeriod: e.target.value as PlanInput["tierPeriod"] })} className={`${selectClass} w-48!`}>
              <option value="pay_period">Each pay period</option>
              <option value="month">Each month</option>
            </select>
          </label>
        </div>
      )}
      {example && (
        <p className="text-sm text-ink-muted" data-testid="tier-example">
          For example, {example}
        </p>
      )}
      {p.mode !== "hourly" && (
        <div className="flex flex-wrap items-end gap-4">
          <label className={labelClass}>
            Back-bar fee
            <select value={p.backbarKind} onChange={(e) => setP({ ...p, backbarKind: e.target.value as PlanInput["backbarKind"] })} className={`${selectClass} w-52!`}>
              <option value="none">None</option>
              <option value="fixed">A set amount per service</option>
              <option value="percent">A percent of each service</option>
            </select>
          </label>
          {p.backbarKind !== "none" && (
            <label className={labelClass}>
              {p.backbarKind === "fixed" ? "Per service ($)" : "Percent (%)"}
              <input value={p.backbarValue} onChange={(e) => setP({ ...p, backbarValue: e.target.value })} inputMode="decimal" className={`${fieldClass} w-28!`} />
            </label>
          )}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className={checkboxClass} checked={p.isDefault} onChange={(e) => setP({ ...p, isDefault: e.target.checked })} />
        Default for new team members
      </label>
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {planId ? "Save plan" : "Add plan"}
      </Button>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}

export function ArchivePlan({ planId, name }: { planId: string; name: string }) {
  const [result, setResult] = useState<PlanResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      {result && !result.ok && <span className="text-sm text-danger">{result.message}</span>}
      <Button
        variant="danger-quiet"
        size="sm"
        disabled={pending}
        aria-label={`Remove ${name}`}
        onClick={() => {
          if (confirm(`Remove ${name}? Past pay on it stays as it was.`)) start(async () => setResult(await archiveCommissionPlan(planId)));
        }}
      >
        Remove
      </Button>
    </div>
  );
}

export function TeamPlans({ people, plans }: { people: { id: string; name: string; planId: string | null; own: string }[]; plans: { id: string; name: string }[] }) {
  const [result, setResult] = useState<PlanResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      {result && (
        <div className="px-4 pt-4">
          <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>
        </div>
      )}
      <ul className={listClass} aria-label="Team plans">
        {people.map((person) => (
          <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="font-medium text-ink">{person.name}</span>
            <select
              aria-label={`${person.name}'s plan`}
              defaultValue={person.planId ?? ""}
              disabled={pending}
              className={`${selectClass} w-72!`}
              onChange={(e) => {
                const value = e.target.value || null;
                start(async () => setResult(await setStaffPlan(person.id, value)));
              }}
            >
              <option value="">{person.own}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </>
  );
}
