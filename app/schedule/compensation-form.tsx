"use client";

import { useActionState } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { buttonClass } from "@/components/ui/button";
import { selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { centsToInput } from "@/lib/services";
import { SavedNote } from "./saved-note";
import { LEVEL_LABELS, STAFF_LEVELS, type StaffLevel } from "@/lib/schedule-forms";
import { saveCompensation } from "./actions";

export function CompensationForm({
  staffId,
  level,
  servicePct,
  retailPct,
  hourlyRateCents,
}: {
  staffId: string;
  level: StaffLevel | null;
  servicePct: number;
  retailPct: number;
  hourlyRateCents: number | null;
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
        <Alert className="w-full">{state.message}</Alert>
      )}
      <Field label="Level" error={errors.level}>
        <select name="level" defaultValue={level ?? ""} className={`${selectClass} w-40!`}>
          <option value="">No level</option>
          {STAFF_LEVELS.map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABELS[l]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Service commission (%)" error={errors.service_commission_pct}>
        <input name="service_commission_pct" inputMode="decimal" defaultValue={String(servicePct)} className={`${inputClass} w-36!`} />
      </Field>
      <Field label="Retail commission (%)" error={errors.retail_commission_pct}>
        <input name="retail_commission_pct" inputMode="decimal" defaultValue={String(retailPct)} className={`${inputClass} w-36!`} />
      </Field>
      <Field label="Hourly rate ($)" error={errors.hourly_rate_cents}>
        <input name="hourly_rate" inputMode="decimal" defaultValue={centsToInput(hourlyRateCents)} placeholder="Not hourly" className={`${inputClass} w-36!`} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass("primary", "md")}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state?.saved && <SavedNote>Saved.</SavedNote>}
    </form>
  );
}
