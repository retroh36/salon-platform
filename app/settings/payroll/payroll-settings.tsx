"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { PAY_PERIOD_LABELS, type HoursBasis, type PayPeriodKind } from "@/lib/payroll";
import { savePayrollHours, savePayrollSettings, type SettingsResult } from "./actions";

export function PayrollSettingsForm({ initial }: { initial: { kind: PayPeriodKind; anchor: string } }) {
  const [s, setS] = useState(initial);
  const [result, setResult] = useState<SettingsResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Payroll settings"
      className="flex max-w-lg flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await savePayrollSettings(s)));
      }}
    >
      <label className={labelClass}>
        Pay period
        <select value={s.kind} onChange={(e) => setS({ ...s, kind: e.target.value as PayPeriodKind })} className={selectClass}>
          {(Object.keys(PAY_PERIOD_LABELS) as PayPeriodKind[]).map((k) => (
            <option key={k} value={k}>
              {PAY_PERIOD_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {(s.kind === "weekly" || s.kind === "biweekly") && (
        <label className={labelClass}>
          First day of any pay period
          <input type="date" value={s.anchor} onChange={(e) => setS({ ...s, anchor: e.target.value })} className={fieldClass} />
          <span className="text-13 font-normal text-ink-muted">Any first day of a period, past or future; the others follow from it.</span>
        </label>
      )}
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        Save
      </Button>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}

const BASIS_OPTIONS = [
  { value: "scheduled", label: "Scheduled hours", hint: "Their shifts on the published schedule, less approved time off." },
  { value: "clocked", label: "Clocked hours", hint: "What they clocked in and out, on My day or at the front desk." },
] as const;

// Which hours pay people paid by the hour. Owners change it; everyone else
// with payroll sees it.
export function PayrollHoursForm({ initial, timeClock, owner }: { initial: HoursBasis; timeClock: boolean; owner: boolean }) {
  const [basis, setBasis] = useState(initial);
  const [result, setResult] = useState<SettingsResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Hours for hourly pay"
      className="flex max-w-lg flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await savePayrollHours(basis)));
      }}
    >
      <fieldset className="flex flex-col gap-3" disabled={!owner || pending}>
        <legend className="mb-2 text-sm font-medium text-ink">Pay hourly staff for</legend>
        {BASIS_OPTIONS.map((o) => (
          <label key={o.value} className="flex items-start gap-2.5 text-sm text-ink">
            <input type="radio" name="basis" value={o.value} checked={basis === o.value} disabled={o.value === "clocked" && !timeClock && basis !== "clocked"} onChange={() => setBasis(o.value)} className={`${checkboxClass} mt-0.5 rounded-full`} />
            <span>
              <span className="font-medium">{o.label}</span>
              <span className="block text-13 text-ink-muted">
                {o.hint}
                {o.value === "clocked" && !timeClock ? " Turn on the time clock on Settings → Shared devices to choose it." : ""}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {owner ? (
        <Button type="submit" variant="secondary" disabled={pending || basis === initial} className="self-start">
          Save hours
        </Button>
      ) : (
        <p className="text-13 text-ink-muted">Only owners change this.</p>
      )}
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
