"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveService, type ServiceFormFields } from "./actions";

export type StaffOption = { id: string; name: string; role: string; color: string | null; isActive: boolean };

const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-600";

export function ServiceForm({
  serviceId,
  initial,
  staffOptions,
  categories,
  readOnly,
}: {
  serviceId?: string;
  initial: ServiceFormFields;
  staffOptions: StaffOption[];
  categories: string[];
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(saveService, undefined);
  // After a failed save, show what was submitted rather than the original values.
  const fields = state?.fields ?? initial;
  const errors = state?.errors ?? {};
  // Mirrors the checkboxes, to enable price inputs and show the count. After
  // a failed save it still matches: the reset restores the submitted choices.
  const [offered, setOffered] = useState(() => new Set(Object.keys(initial.staff)));

  const toggle = (id: string, on: boolean) =>
    setOffered((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      {serviceId && <input type="hidden" name="service_id" value={serviceId} />}

      {state?.message && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}

      <fieldset disabled={readOnly || pending} className="flex flex-col gap-6">
        <section className="grid gap-4 rounded-xl border border-neutral-200 bg-white p-5 sm:grid-cols-2">
          <Field label="Name" error={errors.name} className="sm:col-span-2">
            <input name="name" defaultValue={fields.name} maxLength={100} required className={inputClass} />
          </Field>
          <Field label="Category" error={errors.category}>
            <input name="category" defaultValue={fields.category} list="service-categories" maxLength={50} required className={inputClass} />
            <datalist id="service-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Default price ($)" error={errors.price_cents}>
            <input name="price" defaultValue={fields.price} inputMode="decimal" required className={inputClass} />
          </Field>
          <Field label="Description (optional)" className="sm:col-span-2">
            <textarea name="description" defaultValue={fields.description} rows={2} className={inputClass} />
          </Field>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="font-medium">Time</h2>
          <p className="mb-4 text-sm text-neutral-500">
            The stylist is free during processing, so other clients can be booked into that gap. Use 5-minute steps.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Service time (min)" hint="Stylist busy" error={errors.active_minutes}>
              <input name="active_minutes" type="number" min={5} step={5} defaultValue={fields.active_minutes} required className={inputClass} />
            </Field>
            <Field label="Processing gap (min)" hint="Stylist free" error={errors.processing_minutes}>
              <input name="processing_minutes" type="number" min={0} step={5} defaultValue={fields.processing_minutes} className={inputClass} />
            </Field>
            <Field label="Finishing time (min)" hint="After processing" error={errors.finishing_minutes}>
              <input name="finishing_minutes" type="number" min={0} step={5} defaultValue={fields.finishing_minutes} className={inputClass} />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-5 py-3">
            <h2 className="font-medium">
              Who offers this <span className="text-neutral-500">({offered.size})</span>
            </h2>
            <p className="text-sm text-neutral-500">Leave a price blank to use the default price.</p>
          </div>
          <ul className="divide-y divide-neutral-100">
            {staffOptions.map((s) => {
              const checked = offered.has(s.id);
              const error = errors.staff?.[s.id];
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <label className="flex min-w-56 flex-1 items-center gap-3">
                    {/* Uncontrolled like the other fields: React resets the form
                        after each submit, and a reset restores defaultChecked. */}
                    <input
                      type="checkbox"
                      name="staff"
                      value={s.id}
                      defaultChecked={s.id in fields.staff}
                      onChange={(e) => toggle(s.id, e.target.checked)}
                      className="size-4"
                    />
                    <span
                      aria-hidden
                      className="size-3 shrink-0 rounded-full bg-neutral-300"
                      style={s.color ? { backgroundColor: s.color } : undefined}
                    />
                    <span className="font-medium">{s.name}</span>
                    <span className="text-sm text-neutral-500">
                      {s.role}
                      {!s.isActive && " · inactive"}
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-neutral-600">
                    Price ($)
                    <input
                      name={`price_${s.id}`}
                      defaultValue={fields.staff[s.id] ?? ""}
                      disabled={!checked}
                      placeholder={fields.price ? `Default $${fields.price}` : "Default"}
                      inputMode="decimal"
                      aria-label={`${s.name} price`}
                      className={`${inputClass} w-32 py-1.5`}
                    />
                  </label>
                  {error && <p className="w-full text-sm text-red-600">{error}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      </fieldset>

      <div className="flex items-center gap-3">
        {!readOnly && (
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
          >
            {pending ? "Saving…" : serviceId ? "Save changes" : "Add service"}
          </button>
        )}
        <Link href="/services" className="rounded-md px-4 py-2 text-neutral-600 hover:text-neutral-900">
          {readOnly ? "Back to services" : "Cancel"}
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm font-medium ${className}`}>
      <span>
        {label}
        {hint && <span className="ml-1 font-normal text-neutral-500">· {hint}</span>}
      </span>
      {children}
      {error && <span className="font-normal text-red-600">{error}</span>}
    </label>
  );
}
