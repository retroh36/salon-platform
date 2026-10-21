"use client";

import { useActionState } from "react";
import { useEffect, useRef } from "react";
import { addFormula } from "./actions";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/page";

export function FormulaForm({ clientId, today }: { clientId: string; today: string }) {
  const [state, action, pending] = useActionState(addFormula.bind(null, clientId), undefined);
  // Keep typed values after an error; start blank after a successful save.
  const fields = state && !state.saved ? state.fields : { visit_date: today, formula: "", notes: "" };
  const errors = state && !state.saved ? state.errors : {};
  const formRef = useRef<HTMLFormElement>(null);

  // The form isn't reset automatically (see submitWithoutReset), so clear it
  // once an entry is saved.
  useEffect(() => {
    if (state?.saved) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} onSubmit={submitWithoutReset(action)} className="grid gap-4 border-b border-line bg-sunken/40 p-5 sm:grid-cols-[11rem_1fr]" noValidate>
      {state && !state.saved && state.message && (
        <Alert className="sm:col-span-2">{state.message}</Alert>
      )}
      <Field label="Visit date" error={errors.visit_date}>
        <input name="visit_date" type="date" max={today} defaultValue={fields.visit_date} required className={inputClass} />
      </Field>
      <Field label="Formula" error={errors.formula}>
        <textarea
          name="formula"
          defaultValue={fields.formula}
          rows={2}
          required
          placeholder="e.g. Roots: Shades EQ 6N + 6NB (1:1), 20 vol, 35 min"
          className={inputClass}
        />
      </Field>
      <Field label="Notes (optional)" className="sm:col-start-2">
        <input name="notes" defaultValue={fields.notes} className={inputClass} />
      </Field>
      <div className="flex items-center gap-3 sm:col-start-2">
        <button type="submit" disabled={pending} className={buttonClass("primary", "md")}>
          {pending ? "Saving…" : "Add formula entry"}
        </button>
        {state?.saved && (
          <span role="status" className="animate-fade-in text-sm font-medium text-status-confirmed-ink">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
