"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { adjustPto } from "./actions";

export function AdjustForm({ staffId, firstName, today }: { staffId: string; firstName: string; today: string }) {
  const [state, action, pending] = useActionState(adjustPto.bind(null, staffId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-[8rem_7rem_10rem_minmax(0,1fr)]" aria-label={`Adjust ${firstName}'s balance`}>
      <label className={labelClass}>
        Change
        <select name="direction" className={selectClass}>
          <option value="add">Add</option>
          <option value="take">Take off</option>
        </select>
      </label>
      <label className={labelClass}>
        Hours
        <input name="hours" type="number" min={0.25} max={4000} step={0.25} className={fieldClass} required />
      </label>
      <label className={labelClass}>
        Counts from
        <input name="on_date" type="date" defaultValue={today} className={fieldClass} required />
      </label>
      <label className={labelClass}>
        Reason
        <input name="reason" maxLength={300} className={fieldClass} placeholder="Starting balance" required />
      </label>
      <div className="flex items-center gap-3 sm:col-span-4">
        <Button type="submit" variant="primary" disabled={pending}>
          Save adjustment
        </Button>
        <span className="text-13 text-ink-muted">Kept with who made it and why, in the Audit trail.</span>
      </div>
      {state?.message && (
        <Alert tone={state.ok ? "success" : "error"} className="sm:col-span-4">
          {state.message}
        </Alert>
      )}
    </form>
  );
}
