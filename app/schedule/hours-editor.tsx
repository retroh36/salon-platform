"use client";

import { useActionState, useState } from "react";
import { inputClass, submitWithoutReset } from "@/components/form";
import { WEEKDAY_NAMES } from "@/lib/schedule-forms";
import { WEEKDAYS, type Weekday } from "@/lib/scheduling/time";
import type { FormState } from "./actions";

export type HoursRows = Partial<Record<Weekday, { start: string; end: string }[]>>;

type Action = (state: FormState<Partial<Record<Weekday, string>>>, formData: FormData) => Promise<FormState<Partial<Record<Weekday, string>>>>;

// Weekly hours, one row per shift; two rows on a day make a split shift.
// Used for staff working hours and location opening hours.
export function HoursEditor({ action, initial, label }: { action: Action; initial: HoursRows; label: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [rows, setRows] = useState<HoursRows>(initial);

  const update = (day: Weekday, index: number, field: "start" | "end", value: string) =>
    setRows((r) => ({ ...r, [day]: (r[day] ?? []).map((row, i) => (i === index ? { ...row, [field]: value } : row)) }));
  const add = (day: Weekday) =>
    setRows((r) => {
      const existing = r[day] ?? [];
      const last = existing.at(-1);
      // A sensible default: after the last shift, or a 9-5 day.
      return { ...r, [day]: [...existing, last ? { start: last.end, end: "" } : { start: "09:00", end: "17:00" }] };
    });
  const remove = (day: Weekday, index: number) =>
    setRows((r) => ({ ...r, [day]: (r[day] ?? []).filter((_, i) => i !== index) }));

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} aria-label={label} noValidate>
      {state?.message && !state.saved && (
        <p role="alert" className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}
      <ul className="divide-y divide-neutral-100">
        {WEEKDAYS.map((day) => {
          const dayRows = rows[day] ?? [];
          const error = state?.errors?.[day];
          return (
            <li key={day} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3" aria-label={WEEKDAY_NAMES[day]}>
              <span className="w-28 pt-2 text-sm font-medium">{WEEKDAY_NAMES[day]}</span>
              <div className="flex flex-1 flex-col gap-2">
                {dayRows.length === 0 && <span className="pt-2 text-sm text-neutral-500">Off</span>}
                {dayRows.map((row, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      step={300}
                      name={`start_${day}`}
                      value={row.start}
                      onChange={(e) => update(day, i, "start", e.target.value)}
                      aria-label={`${WEEKDAY_NAMES[day]} shift ${i + 1} start`}
                      aria-invalid={error ? true : undefined}
                      className={`${inputClass} w-32 py-1.5`}
                    />
                    <span className="text-sm text-neutral-500">to</span>
                    <input
                      type="time"
                      step={300}
                      name={`end_${day}`}
                      value={row.end}
                      onChange={(e) => update(day, i, "end", e.target.value)}
                      aria-label={`${WEEKDAY_NAMES[day]} shift ${i + 1} end`}
                      aria-invalid={error ? true : undefined}
                      className={`${inputClass} w-32 py-1.5`}
                    />
                    <button
                      type="button"
                      onClick={() => remove(day, i)}
                      aria-label={`Remove ${WEEKDAY_NAMES[day]} shift ${i + 1}`}
                      className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>
              <button
                type="button"
                onClick={() => add(day)}
                aria-label={dayRows.length ? `Add a split shift on ${WEEKDAY_NAMES[day]}` : `Add hours on ${WEEKDAY_NAMES[day]}`}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
              >
                {dayRows.length ? "Add split" : "Add hours"}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3 border-t border-neutral-200 px-5 py-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save hours"}
        </button>
        {state?.saved && (
          <span role="status" className="text-sm text-green-700">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
