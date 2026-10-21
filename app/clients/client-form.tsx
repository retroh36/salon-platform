"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Field, submitWithoutReset } from "@/components/form";
import { saveClient, type ClientFormFields } from "./actions";

export type StylistOption = { id: string; name: string };

const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-500";

export function ClientForm({
  clientId,
  initial,
  stylists,
  today,
}: {
  clientId?: string;
  initial: ClientFormFields;
  stylists: StylistOption[];
  today: string;
}) {
  const [state, action, pending] = useActionState(saveClient, undefined);
  // After a failed save, show what was submitted.
  const fields = state?.fields ?? initial;
  const errors = state?.errors ?? {};
  const [consent, setConsent] = useState(initial.consent_signed);

  return (
    <form action={action} onSubmit={submitWithoutReset(action)} className="flex flex-col gap-6" noValidate>
      {clientId && <input type="hidden" name="client_id" value={clientId} />}
      {state?.message && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}

      <fieldset disabled={pending} className="flex flex-col gap-6">
        <section className="grid gap-4 rounded-xl border border-neutral-200 bg-white p-5 sm:grid-cols-2">
          <h2 className="font-medium sm:col-span-2">Contact</h2>
          <Field label="First name" error={errors.first_name}>
            <input name="first_name" defaultValue={fields.first_name} autoComplete="off" required className={inputClass} />
          </Field>
          <Field label="Last name">
            <input name="last_name" defaultValue={fields.last_name} autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <input name="phone" type="tel" defaultValue={fields.phone} autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Email" error={errors.email}>
            <input name="email" type="email" defaultValue={fields.email} autoComplete="off" className={inputClass} />
          </Field>
          <div className="flex flex-wrap gap-6 text-sm sm:col-span-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="sms_opt_in" defaultChecked={fields.sms_opt_in} className="size-4" />
              Texts OK (reminders and offers)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="email_opt_in" defaultChecked={fields.email_opt_in} className="size-4" />
              Marketing emails OK
            </label>
          </div>
        </section>

        <section className="grid gap-4 rounded-xl border border-neutral-200 bg-white p-5 sm:grid-cols-2">
          <h2 className="font-medium sm:col-span-2">Care</h2>
          <Field label="Allergies and sensitivities" hint="Shown on every visit" className="sm:col-span-2">
            <textarea name="allergies" defaultValue={fields.allergies} rows={2} className={inputClass} />
          </Field>
          <Field label="Preferred stylist">
            <select name="preferred_staff_id" defaultValue={fields.preferred_staff_id} className={inputClass}>
              <option value="">No preference</option>
              {stylists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Preferences">
            <input name="preferences" defaultValue={fields.preferences} className={inputClass} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <textarea name="notes" defaultValue={fields.notes} rows={3} className={inputClass} />
          </Field>
          <div className="flex flex-wrap items-end gap-4 sm:col-span-2">
            <label className="flex items-center gap-2 py-2 text-sm font-medium">
              <input
                type="checkbox"
                name="consent_signed"
                defaultChecked={fields.consent_signed}
                onChange={(e) => setConsent(e.target.checked)}
                className="size-4"
              />
              Consent form signed
            </label>
            <Field label="Signed on" error={errors.consent_signed_on}>
              <input
                name="consent_signed_on"
                type="date"
                max={today}
                defaultValue={fields.consent_signed_on || today}
                disabled={!consent}
                className={inputClass}
              />
            </Field>
          </div>
        </section>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : clientId ? "Save changes" : "Add client"}
        </button>
        <Link href={clientId ? `/clients/${clientId}` : "/clients"} className="px-4 py-2 text-neutral-600 hover:text-neutral-900">
          Cancel
        </Link>
      </div>
    </form>
  );
}
