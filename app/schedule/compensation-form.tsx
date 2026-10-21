"use client";

import { useActionState } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { LEVEL_LABELS, STAFF_LEVELS, type StaffLevel } from "@/lib/schedule-forms";
import { saveCompensation } from "./actions";

export function CompensationForm({
  staffId,
  level,
  servicePct,
  retailPct,
}: {
  staffId: string;
  level: StaffLevel | null;
  servicePct: number;
  retailPct: number;
}) {
  const [state, action, pending] = useActionState(saveCompensation.bind(null, staffId), undefined);
  const errors = state?.errors ?? {};

  return (
    <form
      action={action}
      onSubmit={submitWithoutReset(action)}
      aria-label="Level and commission"
      className="flex flex-wrap items-end gap-4 p-5"
      noValidate
    >
      {state?.message && !state.saved && (
        <p role="alert" className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}
      <Field label="Level" error={errors.level}>
        <select name="level" defaultValue={level ?? ""} className={`${inputClass} w-40`}>
          <option value="">No level</option>
          {STAFF_LEVELS.map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABELS[l]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Service commission (%)" error={errors.service_commission_pct}>
        <input name="service_commission_pct" inputMode="decimal" defaultValue={String(servicePct)} className={`${inputClass} w-32`} />
      </Field>
      <Field label="Retail commission (%)" error={errors.retail_commission_pct}>
        <input name="retail_commission_pct" inputMode="decimal" defaultValue={String(retailPct)} className={`${inputClass} w-32`} />
      </Field>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {state?.saved && (
        <span role="status" className="text-sm text-green-700">
          Saved.
        </span>
      )}
    </form>
  );
}
