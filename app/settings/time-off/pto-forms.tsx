"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { REASON_LABELS } from "@/lib/schedule-forms";
import { roleLabel } from "@/lib/staff";
import { savePtoPolicy, saveTimeOffTypes, type TimeOffSettingsState, type TypeInput } from "./actions";

const REASONS = ["vacation", "sick", "personal", "other"] as const;

// The salon's types of time off: a name, how the calendar and Denise
// word it, and whether it uses the PTO balance. Saved as a whole list.
export function TypesEditor({ initial }: { initial: TypeInput[] }) {
  const [types, setTypes] = useState(initial);
  const [result, setResult] = useState<TimeOffSettingsState>(undefined);
  const [pending, start] = useTransition();
  const set = (i: number, change: Partial<TypeInput>) => setTypes(types.map((t, j) => (j === i ? { ...t, ...change } : t)));
  return (
    <div className="flex flex-col gap-3" data-testid="time-off-types">
      <ul className="divide-y divide-line">
        {types.map((t, i) => (
          <li key={t.id ?? `new-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_9rem_auto_auto]">
            <label className={labelClass}>
              Name
              <input className={fieldClass} value={t.name} maxLength={40} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Type ${i + 1} name`} />
            </label>
            <label className={`${labelClass} max-sm:order-3`}>
              Shows as
              <select className={selectClass} value={t.reason} onChange={(e) => set(i, { reason: e.target.value as TypeInput["reason"] })} aria-label={`Type ${i + 1} shows as`}>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {REASON_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex h-9 items-center gap-2 text-sm text-ink max-sm:order-4">
              <input type="checkbox" className={checkboxClass} checked={t.usesPto} onChange={(e) => set(i, { usesPto: e.target.checked })} />
              Uses PTO
            </label>
            <Button variant="quiet" size="sm" className="text-danger" disabled={types.length === 1} onClick={() => setTypes(types.filter((_, j) => j !== i))} aria-label={`Remove ${t.name || "this type"}`}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={types.length >= 12} onClick={() => setTypes([...types, { id: null, name: "", reason: "other", usesPto: false }])}>
          Add a type
        </Button>
        <Button variant="primary" disabled={pending} onClick={() => start(async () => setResult(await saveTimeOffTypes(types)))}>
          Save types
        </Button>
      </div>
      {result?.message && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </div>
  );
}

export type PolicyFormValue = {
  isOn: boolean;
  accrual: "yearly" | "per_hour" | "per_period";
  yearlyHours: number;
  prorate: boolean;
  earnHours: number;
  perHours: number;
  periodHours: number;
  yearStartMonth: number;
  carryOver: "all" | "none" | "up_to";
  carryHours: number;
  capHours: number | null;
  trackingFrom: string;
  roles: string[];
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ROLES = ["manager", "front_desk", "stylist", "assistant", "owner", "bookkeeper"] as const;

export function PtoPolicyForm({ value }: { value: PolicyFormValue }) {
  const [state, action, pending] = useActionState(savePtoPolicy, undefined);
  const [accrual, setAccrual] = useState(value.accrual);
  const [carry, setCarry] = useState(value.carryOver);
  const [on, setOn] = useState(value.isOn);
  return (
    <form action={action} className="flex flex-col gap-4" aria-label="PTO policy">
      <label className="flex items-start gap-2.5 text-sm text-ink">
        <input type="checkbox" name="is_on" className={checkboxClass} checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>
          <span className="font-medium">Track PTO balances</span>
          <span className="block text-13 text-ink-muted">Time off of the types that use PTO comes out of each person&rsquo;s balance, by their working hours.</span>
        </span>
      </label>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            How it&rsquo;s earned
            <select name="accrual" className={selectClass} value={accrual} onChange={(e) => setAccrual(e.target.value as PolicyFormValue["accrual"])}>
              <option value="yearly">A yearly amount</option>
              <option value="per_hour">Per hour worked</option>
              <option value="per_period">Per pay period</option>
            </select>
          </label>
          {accrual === "yearly" && (
            <label className={labelClass}>
              Hours a year
              <input name="yearly_hours" type="number" min={0} max={2000} step={0.25} defaultValue={value.yearlyHours} className={fieldClass} />
            </label>
          )}
          {accrual === "per_hour" && (
            <div className="flex items-end gap-2">
              <label className={labelClass}>
                Hours earned
                <input name="earn_hours" type="number" min={0.25} max={10} step={0.25} defaultValue={value.earnHours} className={`${fieldClass} w-24`} />
              </label>
              <label className={labelClass}>
                For every … hours worked
                <input name="per_hours" type="number" min={1} max={400} step={1} defaultValue={value.perHours} className={`${fieldClass} w-24`} />
              </label>
            </div>
          )}
          {accrual === "per_period" && (
            <label className={labelClass}>
              Hours each pay period
              <input name="period_hours" type="number" min={0} max={100} step={0.25} defaultValue={value.periodHours} className={fieldClass} />
            </label>
          )}
        </div>
        {accrual === "yearly" && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="prorate" className={checkboxClass} defaultChecked={value.prorate} />
            Someone who starts partway through gets part of the year&rsquo;s hours
          </label>
        )}
        {accrual === "per_hour" && <p className="text-13 text-ink-muted">Hours worked are clocked hours if the team uses the time clock, else their scheduled hours.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            The PTO year starts
            <select name="year_start_month" className={selectClass} defaultValue={value.yearStartMonth}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m} 1
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Balances start from
            <input name="tracking_from" type="date" defaultValue={value.trackingFrom} className={fieldClass} />
          </label>
          <label className={labelClass}>
            At the year&rsquo;s end
            <select name="carry_over" className={selectClass} value={carry} onChange={(e) => setCarry(e.target.value as PolicyFormValue["carryOver"])}>
              <option value="up_to">Carry over up to a limit</option>
              <option value="all">Everything carries over</option>
              <option value="none">Nothing carries over</option>
            </select>
          </label>
          {carry === "up_to" && (
            <label className={labelClass}>
              Hours that carry over
              <input name="carry_hours" type="number" min={0} max={2000} step={0.25} defaultValue={value.carryHours} className={fieldClass} />
            </label>
          )}
          <label className={labelClass}>
            Most anyone can hold (hours)
            <input name="cap_hours" type="number" min={1} max={4000} step={0.25} defaultValue={value.capHours ?? ""} placeholder="No cap" className={fieldClass} />
          </label>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">Who earns PTO</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name={`role_${r}`} className={checkboxClass} defaultChecked={value.roles.includes(r)} />
                {roleLabel(r)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          Save PTO policy
        </Button>
      </div>
      {state?.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
    </form>
  );
}
