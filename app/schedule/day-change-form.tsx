"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { saveDayChange } from "./actions";

// One-off hours for a single date (e.g. a late shift), replacing the weekly hours.
export function DayChangeForm({ staffId, today }: { staffId: string; today: string }) {
  const [state, action, pending] = useActionState(saveDayChange.bind(null, staffId), undefined);
  const [rows, setRows] = useState([{ start: "", end: "" }]);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state?.errors ?? {};

  // After a save, clear the form for the next change.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.saved) setRows([{ start: "", end: "" }]);
  }
  useEffect(() => {
    if (state?.saved) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={submitWithoutReset(action)}
      aria-label="Change hours for one day"
      className="flex flex-wrap items-end gap-3 p-5"
      noValidate
    >
      {state?.message && !state.saved && (
        <p role="alert" className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}
      <Field label="Date" error={errors.date}>
        <input name="on_date" type="date" min={today} defaultValue={today} className={inputClass} />
      </Field>
      {rows.map((row, i) => (
        <div key={i} className="flex items-end gap-2">
          <Field label={i === 0 ? "From" : `From (${i + 1})`}>
            <input
              name="start_day"
              type="time"
              step={300}
              value={row.start}
              onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
              className={`${inputClass} w-32`}
            />
          </Field>
          <Field label={i === 0 ? "To" : `To (${i + 1})`}>
            <input
              name="end_day"
              type="time"
              step={300}
              value={row.end}
              onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
              className={`${inputClass} w-32`}
            />
          </Field>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows((r) => [...r, { start: r.at(-1)?.end ?? "", end: "" }])}
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
      >
        Add split
      </button>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save change"}
      </button>
      {errors.hours && <p className="w-full text-sm text-red-600">{errors.hours}</p>}
      {state?.saved && (
        <span role="status" className="text-sm text-green-700">
          Saved.
        </span>
      )}
    </form>
  );
}
