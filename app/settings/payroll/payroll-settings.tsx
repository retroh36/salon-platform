"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { PAY_PERIOD_LABELS, type PayPeriodKind } from "@/lib/payroll";
import { savePayrollSettings, type SettingsResult } from "./actions";

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
