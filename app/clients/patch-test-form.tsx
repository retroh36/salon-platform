"use client";

import { useActionState, useEffect, useRef } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { buttonClass } from "@/components/ui/button";
import { selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { useCloseRecord } from "./add-record";
import { recordPatchTest } from "./forms-actions";
import { toLocal } from "@/lib/scheduling/time";

// 10am, or before 10am at the salon the time now (to the quarter hour
// before), since a test can't be recorded before it's done. Only drawn
// once "Add patch test" is tapped, so never on the server.
function defaultTime(timeZone: string): string {
  const minute = Math.min(10 * 60, Math.floor(toLocal(new Date(), timeZone).minute / 15) * 15);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

// `compact`: two columns, for a side panel (booking details).
export function PatchTestForm({ clientId, today, timeZone, me, staff, compact = false }: { clientId: string; today: string; timeZone: string; me: string; staff: { id: string; name: string }[]; compact?: boolean }) {
  const [state, action, pending] = useActionState(recordPatchTest.bind(null, clientId), undefined);
  const formRef = useRef<HTMLFormElement>(null);
  // Opened from "Add patch test": closes once saved.
  const close = useCloseRecord();
  useEffect(() => {
    if (!state?.ok) return;
    formRef.current?.reset();
    close?.();
  }, [state, close]);

  return (
    <form ref={formRef} action={action} onSubmit={submitWithoutReset(action)} aria-label="Record patch test" className={compact ? "grid grid-cols-2 gap-3 rounded-lg border border-line bg-sunken/40 p-3 [&>*:nth-last-child(-n+3)]:col-span-2" : "grid gap-4 pb-4 sm:grid-cols-4"} noValidate>
      {state && !state.ok && <Alert className={compact ? "col-span-2" : "sm:col-span-4"}>{state.message}</Alert>}
      <Field label="Date">
        <input name="date" type="date" max={today} defaultValue={today} className={inputClass} />
      </Field>
      <Field label="Time">
        <input name="time" type="time" defaultValue={defaultTime(timeZone)} className={inputClass} />
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
        {close && (
          <button type="button" onClick={close} className={buttonClass("quiet", "md")}>
            Cancel
          </button>
        )}
        {state?.ok && (
          <span role="status" className="animate-fade-in text-sm text-ink-muted">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
