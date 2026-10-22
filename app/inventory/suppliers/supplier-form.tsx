"use client";

import { useActionState, useEffect, useRef } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { buttonClass } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/page";
import { addSupplier } from "../actions";

export function SupplierForm() {
  const [state, action, pending] = useActionState(addSupplier, undefined);
  const form = useRef<HTMLFormElement>(null);
  const fields = state?.fields ?? {};
  useEffect(() => {
    if (state?.saved) form.current?.reset();
  }, [state]);
  return (
    <Card title="Add a supplier" titleId="add-supplier">
      <form ref={form} action={action} onSubmit={submitWithoutReset(action)} noValidate aria-label="Add a supplier" className="grid gap-4 sm:grid-cols-3">
        {state?.message && <Alert className="sm:col-span-3">{state.message}</Alert>}
        <Field label="Name">
          <input name="name" defaultValue={fields.name} required className={inputClass} />
        </Field>
        <Field label="Email" hint="optional">
          <input name="email" type="email" defaultValue={fields.email} className={inputClass} />
        </Field>
        <Field label="Phone" hint="optional">
          <input name="phone" defaultValue={fields.phone} className={inputClass} />
        </Field>
        <Field label="Account number" hint="optional">
          <input name="account_number" defaultValue={fields.account_number} className={inputClass} />
        </Field>
        <Field label="Days to deliver">
          <input name="lead_time_days" type="number" min={0} max={60} defaultValue={fields.lead_time_days ?? "3"} className={inputClass} />
        </Field>
        <div className="flex items-end gap-3">
          <button type="submit" disabled={pending} className={buttonClass("primary", "md")}>
            Add supplier
          </button>
          {state?.saved && (
            <span role="status" className="animate-fade-in pb-2 text-sm font-medium text-status-confirmed-ink">
              Added.
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}
