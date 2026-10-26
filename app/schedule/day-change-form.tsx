"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/page";
import { SavedNote } from "./saved-note";
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
      className="flex flex-wrap items-end gap-3 p-4"
      noValidate
    >
      {state?.message && !state.saved && (
        <Alert className="w-full">{state.message}</Alert>
      )}
      <Field label="Date" error={errors.date}>
        <input name="on_date" type="date" min={today} defaultValue={today} className={inputClass} />
      </Field>
      {rows.map((row, i) => (
        <div key={i} className="flex animate-fade-in items-end gap-2">
          <Field label={i === 0 ? "From" : `From (${i + 1})`}>
            <input
              name="start_day"
              type="time"
              step={300}
              value={row.start}
              onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
              className={`${inputClass} w-36!`}
            />
          </Field>
          <Field label={i === 0 ? "To" : `To (${i + 1})`}>
            <input
              name="end_day"
              type="time"
              step={300}
              value={row.end}
              onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
              className={`${inputClass} w-36!`}
            />
          </Field>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows((r) => [...r, { start: r.at(-1)?.end ?? "", end: "" }])}
        className={buttonClass("secondary", "md")}
      >
        Add split
      </button>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("primary", "md")}
      >
        {pending ? "Saving…" : "Save change"}
      </button>
      {errors.hours && <p className="w-full animate-fade-in text-sm text-danger">{errors.hours}</p>}
      {state?.saved && <SavedNote>Saved.</SavedNote>}
    </form>
  );
}
