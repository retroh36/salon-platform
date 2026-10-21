"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { REASON_LABELS, TIME_OFF_REASONS, type TimeOffErrors } from "@/lib/schedule-forms";
import { addTimeOff } from "./actions";

// Managers add approved time off for anyone; everyone else requests it for
// themselves (the server decides which).
export function TimeOffForm({ staffId, today, isRequest }: { staffId: string; today: string; isRequest: boolean }) {
  const [state, action, pending] = useActionState(addTimeOff.bind(null, staffId), undefined);
  const [partDay, setPartDay] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errors: TimeOffErrors = state?.errors ?? {};

  // After a save, clear the form for the next entry.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.saved) setPartDay(false);
  }
  useEffect(() => {
    if (state?.saved) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={submitWithoutReset(action)}
      aria-label={isRequest ? "Request time off" : "Add time off"}
      className="grid gap-4 p-5 sm:grid-cols-2"
      noValidate
    >
      {state?.message && !state.saved && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">
          {state.message}
        </p>
      )}
      <Field label="First day" error={errors.starts_on}>
        <input name="starts_on" type="date" min={isRequest ? today : undefined} defaultValue={today} className={inputClass} />
      </Field>
      <Field label="Last day" hint="Leave blank for one day" error={errors.ends_on}>
        <input name="ends_on" type="date" min={isRequest ? today : undefined} className={inputClass} />
      </Field>
      <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
        <label className="flex items-center gap-2 py-2 text-sm font-medium">
          <input type="checkbox" name="part_day" onChange={(e) => setPartDay(e.target.checked)} className="size-4" />
          Part of the day
        </label>
        {partDay && (
          <>
            <Field label="From" error={errors.times}>
              <input name="start_time" type="time" step={300} className={`${inputClass} w-32`} />
            </Field>
            <Field label="To">
              <input name="end_time" type="time" step={300} className={`${inputClass} w-32`} />
            </Field>
          </>
        )}
      </div>
      <Field label="Reason" error={errors.reason}>
        <select name="reason" defaultValue="vacation" className={inputClass}>
          {TIME_OFF_REASONS.map((r) => (
            <option key={r} value={r}>
              {REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Note (optional)" error={errors.note}>
        <input name="note" maxLength={500} className={inputClass} />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : isRequest ? "Request time off" : "Add time off"}
        </button>
        {state?.saved && (
          <span role="status" className="text-sm text-green-700">
            {isRequest ? "Request sent." : "Time off added."}
          </span>
        )}
      </div>
    </form>
  );
}
