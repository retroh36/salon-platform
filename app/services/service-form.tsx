"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { checkboxClass, fieldClass } from "@/components/ui/field";
import { LEVEL_BG } from "@/components/ui/level";
import { Alert } from "@/components/ui/page";
import { LEVEL_LABELS, STAFF_LEVELS, type StaffLevel } from "@/lib/schedule-forms";
import { saveService, type ServiceFormFields } from "./actions";

export type StaffOption = { id: string; name: string; role: string; level: StaffLevel | null; color: string | null; isActive: boolean };

const inputClass = fieldClass;
const cardClass = "rounded-lg border border-line bg-surface";
const cardTitle = "text-base font-semibold text-ink";

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

  // The default and level prices as typed, for the stylists' placeholders.
  // Starts again from the fields after each save attempt (the form resets).
  const [typed, setTyped] = useState({ fields, prices: { default: fields.price, ...fields.level_prices } });
  if (typed.fields !== fields) setTyped({ fields, prices: { default: fields.price, ...fields.level_prices } });
  const readPrices = (form: HTMLFormElement) => {
    const value = (name: string) => String(new FormData(form).get(name) ?? "").trim();
    setTyped({ fields, prices: { default: value("price"), ...Object.fromEntries(STAFF_LEVELS.map((l) => [l, value(`level_price_${l}`)])) } as typeof typed.prices });
  };

  // What a stylist charges without their own price: their level's, else the default.
  const placeholderFor = (level: StaffLevel | null) => {
    const byLevel = level ? typed.prices[level] : "";
    const price = byLevel || typed.prices.default;
    return price ? `${byLevel ? LEVEL_LABELS[level!] : "Default"} $${price}` : "Default";
  };

  const toggle = (id: string, on: boolean) =>
    setOffered((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <form action={action} onInput={(e) => readPrices(e.currentTarget)} className="flex flex-col gap-6" noValidate>
      {serviceId && <input type="hidden" name="service_id" value={serviceId} />}

      {state?.message && (
        <Alert>{state.message}</Alert>
      )}

      <fieldset disabled={readOnly || pending} className="flex flex-col gap-6">
        <section className={`grid gap-4 p-4 sm:grid-cols-2 ${cardClass}`}>
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
          <label className="flex items-start gap-3 text-sm sm:col-span-2">
            <input type="checkbox" name="requires_patch_test" defaultChecked={fields.requires_patch_test} className={`${checkboxClass} mt-0.5`} />
            <span>
              <span className="font-medium text-ink">Needs a patch test</span>
              <span className="block text-ink-muted">Warn (or block, in Forms settings) when the client has no valid patch test before this service.</span>
            </span>
          </label>
        </section>

        <section className={`p-4 ${cardClass}`} aria-labelledby="level-prices-heading">
          <h2 id="level-prices-heading" className={cardTitle}>
            Prices by level
          </h2>
          <p className="mb-4 text-sm text-ink-muted">What each level of stylist charges. Leave blank to use the default price.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {STAFF_LEVELS.map((level) => (
              <Field key={level} label={`${LEVEL_LABELS[level]} ($)`} error={errors.level_prices?.[level]}>
                <span className="relative flex items-center">
                  <span aria-hidden className={`absolute left-3 size-2.5 rounded-full ${LEVEL_BG[level]}`} />
                  <input
                    name={`level_price_${level}`}
                    defaultValue={fields.level_prices[level]}
                    inputMode="decimal"
                    placeholder={fields.price ? `Default $${fields.price}` : "Default"}
                    className={`${inputClass} pl-8`}
                  />
                </span>
              </Field>
            ))}
          </div>
        </section>

        <section className={`p-4 ${cardClass}`}>
          <h2 className={cardTitle}>Time</h2>
          <p className="mb-4 text-sm text-ink-muted">
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

        <section className={`overflow-hidden ${cardClass}`}>
          <div className="border-b border-line px-4 py-3">
            <h2 className={cardTitle}>
              Who offers this <span className="font-sans text-sm font-medium text-ink-muted">({offered.size})</span>
            </h2>
            <p className="text-sm text-ink-muted">A stylist&rsquo;s own price overrides their level&rsquo;s. Leave it blank to use their level&rsquo;s price.</p>
          </div>
          <ul className="divide-y divide-line">
            {staffOptions.map((s) => {
              const checked = offered.has(s.id);
              const error = errors.staff?.[s.id];
              return (
                <li
                  key={s.id}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors duration-(--motion-fast) ${checked ? "bg-navy-100/40" : ""}`}
                >
                  <label className="flex min-w-56 flex-1 cursor-pointer items-center gap-3">
                    {/* Uncontrolled like the other fields: React resets the form
                        after each submit, and a reset restores defaultChecked. */}
                    <input
                      type="checkbox"
                      name="staff"
                      value={s.id}
                      defaultChecked={s.id in fields.staff}
                      onChange={(e) => toggle(s.id, e.target.checked)}
                      className={checkboxClass}
                    />
                    <Avatar name={s.name} color={s.color} level={s.level} size="sm" />
                    <span className="font-semibold text-ink">{s.name}</span>
                    <span className="text-sm text-ink-muted">
                      {s.role}
                      {!s.isActive && " · inactive"}
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink-muted">
                    Price ($)
                    <input
                      name={`price_${s.id}`}
                      defaultValue={fields.staff[s.id] ?? ""}
                      disabled={!checked}
                      placeholder={placeholderFor(s.level)}
                      inputMode="decimal"
                      aria-label={`${s.name} price`}
                      className={`${inputClass} w-32! py-1.5`}
                    />
                  </label>
                  {error && <p className="w-full animate-fade-in text-sm text-danger">{error}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      </fieldset>

      <div className="flex items-center gap-3">
        {!readOnly && (
          <button type="submit" disabled={pending} className={buttonClass("primary", "lg")}>
            {pending ? "Saving…" : serviceId ? "Save changes" : "Add service"}
          </button>
        )}
        <Link href="/services" className={buttonClass("ghost", "lg", "text-ink-muted")}>
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
    <label className={`flex flex-col gap-1.5 text-sm font-medium text-ink ${className}`}>
      <span>
        {label}
        {hint && <span className="ml-1 font-normal text-ink-muted">· {hint}</span>}
      </span>
      {children}
      {error && <span className="animate-fade-in font-normal text-danger">{error}</span>}
    </label>
  );
}
