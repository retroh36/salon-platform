"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { buttonClass } from "@/components/ui/button";
import { checkboxClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { MONTHS } from "@/lib/clients";
import { saveClient, type ClientFormFields } from "./actions";

export type StylistOption = { id: string; name: string };

const sectionClass = "grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:grid-cols-2";
const sectionTitle = "font-serif text-lg font-semibold text-ink sm:col-span-2";
const checkLabel = "flex cursor-pointer items-center gap-2.5 text-sm text-ink";

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
        <Alert>{state.message}</Alert>
      )}

      <fieldset disabled={pending} className="flex flex-col gap-6">
        <section className={sectionClass}>
          <h2 className={sectionTitle}>Contact</h2>
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
          <Field label="Birthday (optional)" error={errors.birthday}>
            <div className="flex gap-2">
              <select name="birth_month" aria-label="Birthday month" defaultValue={fields.birth_month} className={`${selectClass} flex-1`}>
                <option value="">Month</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select name="birth_day" aria-label="Birthday day" defaultValue={fields.birth_day} className={`${selectClass} w-24!`}>
                <option value="">Day</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <div className="flex flex-wrap gap-6 sm:col-span-2">
            <label className={checkLabel}>
              <input type="checkbox" name="sms_opt_in" defaultChecked={fields.sms_opt_in} className={checkboxClass} />
              Texts OK (reminders and offers)
            </label>
            <label className={checkLabel}>
              <input type="checkbox" name="email_opt_in" defaultChecked={fields.email_opt_in} className={checkboxClass} />
              Marketing emails OK
            </label>
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className={sectionTitle}>Care</h2>
          <Field label="Allergies and sensitivities" hint="Shown on every visit" className="sm:col-span-2">
            <textarea name="allergies" defaultValue={fields.allergies} rows={2} className={inputClass} />
          </Field>
          <Field label="Preferred stylist">
            <select name="preferred_staff_id" defaultValue={fields.preferred_staff_id} className={selectClass}>
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
            <label className={`${checkLabel} py-2.5 font-medium`}>
              <input
                type="checkbox"
                name="consent_signed"
                defaultChecked={fields.consent_signed}
                onChange={(e) => setConsent(e.target.checked)}
                className={checkboxClass}
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
        <button type="submit" disabled={pending} className={buttonClass("primary", "lg")}>
          {pending ? "Saving…" : clientId ? "Save changes" : "Add client"}
        </button>
        <Link href={clientId ? `/clients/${clientId}` : "/clients"} className={buttonClass("ghost", "lg")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
