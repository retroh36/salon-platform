"use client";

import { useActionState, useEffect, useRef } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { buttonClass } from "@/components/ui/button";
import { selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { recordPatchTest } from "./forms-actions";

// `compact`: two columns, for a side panel (booking details).
export function PatchTestForm({ clientId, today, me, staff, compact = false }: { clientId: string; today: string; me: string; staff: { id: string; name: string }[]; compact?: boolean }) {
  const [state, action, pending] = useActionState(recordPatchTest.bind(null, clientId), undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} onSubmit={submitWithoutReset(action)} aria-label="Record patch test" className={compact ? "grid grid-cols-2 gap-3 rounded-lg border border-line bg-sunken/40 p-3 [&>*:nth-last-child(-n+3)]:col-span-2" : "grid gap-4 border-b border-line bg-sunken/40 p-5 sm:grid-cols-4"} noValidate>
      {state && !state.ok && <Alert className={compact ? "col-span-2" : "sm:col-span-4"}>{state.message}</Alert>}
      <Field label="Date">
        <input name="date" type="date" max={today} defaultValue={today} className={inputClass} />
      </Field>
      <Field label="Time">
        <input name="time" type="time" defaultValue="10:00" className={inputClass} />
      </Field>
      <Field label="Done by">
        <select name="performed_by" defaultValue={me} className={selectClass}>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Result">
        <select name="result" defaultValue="no_reaction" className={selectClass}>
          <option value="no_reaction">No reaction</option>
          <option value="reaction">Reaction</option>
        </select>
      </Field>
      <Field label="Products tested" className="sm:col-span-2">
        <input name="products" placeholder="e.g. Goldwell Topchic 6N + 20 vol" maxLength={500} className={inputClass} />
      </Field>
      <Field label="Notes (optional)" className="sm:col-span-2">
        <input name="notes" maxLength={1000} className={inputClass} />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-4">
        <button type="submit" disabled={pending} className={buttonClass("primary", "md")}>
          {pending ? "Saving…" : "Record patch test"}
        </button>
        {state?.ok && (
          <span role="status" className="animate-fade-in text-sm font-medium text-status-confirmed-ink">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
