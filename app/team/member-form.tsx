"use client";

import { useActionState, useState } from "react";
import { Field, inputClass, submitWithoutReset } from "@/components/form";
import { buttonClass } from "@/components/ui/button";
import { checkboxClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { LEVEL_LABELS, STAFF_LEVELS, WEEKDAY_NAMES } from "@/lib/schedule-forms";
import { WEEKDAYS, type Weekday } from "@/lib/scheduling/time";
import { roleLabel, type StaffRole } from "@/lib/staff";
import { saveMember } from "./actions";

export type MemberFields = { first_name: string; last_name: string; email: string; phone: string; role: StaffRole; level: string; service_ids: string[] };
export type ServiceGroup = { category: string; services: { id: string; name: string }[] };

const sectionClass = "grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:grid-cols-2";
const sectionTitle = "font-serif text-lg font-semibold text-ink sm:col-span-2";

// Adding someone (staffId null, with their weekly hours and an invite), or
// editing their details, role, level and services.
export function MemberForm({
  staffId,
  initial,
  roles,
  services,
  hours,
}: {
  staffId: string | null;
  initial: MemberFields;
  // The roles this person can give; one role means it can't change.
  roles: StaffRole[];
  services: ServiceGroup[];
  // A new member's starting hours (the salon's opening hours), as HH:MM.
  hours?: Partial<Record<Weekday, { start: string; end: string }>>;
}) {
  const [state, action, pending] = useActionState(saveMember.bind(null, staffId), undefined);
  const errors = state?.errors ?? {};
  const [role, setRole] = useState<StaffRole>(initial.role);
  const [picked, setPicked] = useState<Set<string>>(new Set(initial.service_ids));
  const all = services.flatMap((g) => g.services.map((s) => s.id));
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? new Set(p).add(id) : new Set([...p].filter((x) => x !== id))));

  return (
    <form action={action} onSubmit={submitWithoutReset(action)} className="flex flex-col gap-6" noValidate aria-label={staffId ? "Team member" : "Add team member"}>
      {state?.message && <Alert tone={state.saved ? "success" : "error"}>{state.message}</Alert>}
      <fieldset disabled={pending} className="flex flex-col gap-6">
        <section className={sectionClass}>
          <h2 className={sectionTitle}>Who they are</h2>
          <Field label="First name" error={errors.first_name}>
            <input name="first_name" defaultValue={initial.first_name} autoComplete="off" required className={inputClass} />
          </Field>
          <Field label="Last name">
            <input name="last_name" defaultValue={initial.last_name} autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Email" hint="for their login" error={errors.email}>
            <input name="email" type="email" defaultValue={initial.email} autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <input name="phone" type="tel" defaultValue={initial.phone} autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Role" error={errors.role} hint={roles.length === 1 ? "you can't change your own" : undefined}>
            <select name="role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)} disabled={roles.length === 1} className={selectClass}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </Field>
          {roles.length === 1 && <input type="hidden" name="role" value={role} />}
          {role === "stylist" && (
            <Field label="Level">
              <select name="level" defaultValue={initial.level} className={selectClass}>
                <option value="">No level</option>
                {STAFF_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABELS[l]}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </section>

        <section className={sectionClass} aria-label="Services they do">
          <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
            <h2 className="font-serif text-lg font-semibold text-ink">Services they do</h2>
            <span className="flex gap-3 text-sm">
              <button type="button" className="font-medium text-link underline underline-offset-2" onClick={() => setPicked(new Set(all))}>
                Tick all
              </button>
              <button type="button" className="font-medium text-link underline underline-offset-2" onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </span>
          </div>
          <p className="text-sm text-ink-muted sm:col-span-2">Only stylists with a service can be booked for it. Their own prices and lengths for a service stay as long as they do it.</p>
          {services.map((g) => (
            <fieldset key={g.category} className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-semibold text-ink">{g.category}</legend>
              {g.services.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
                  <input type="checkbox" name="service_ids" value={s.id} checked={picked.has(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} className={checkboxClass} />
                  {s.name}
                </label>
              ))}
            </fieldset>
          ))}
        </section>

        {hours && (
          <section className={sectionClass} aria-label="Working hours">
            <h2 className={sectionTitle}>Working hours</h2>
            <p className="text-sm text-ink-muted sm:col-span-2">Starting from the salon&apos;s opening hours. Clear a day they don&apos;t work. Split shifts, one-off changes and time off are on Schedule.</p>
            <input type="hidden" name="hours_included" value="1" />
            {errors.hours && <p className="text-sm text-danger sm:col-span-2">{errors.hours}</p>}
            {WEEKDAYS.map((day) => (
              <div key={day} className="flex flex-wrap items-center gap-2" role="group" aria-label={WEEKDAY_NAMES[day]}>
                <span className="w-24 text-sm font-semibold">{WEEKDAY_NAMES[day]}</span>
                <input type="time" step={300} name={`start_${day}`} defaultValue={hours[day]?.start ?? ""} aria-label={`${WEEKDAY_NAMES[day]} start`} className={`${inputClass} w-32! py-1.5`} />
                <span className="text-sm text-ink-muted">to</span>
                <input type="time" step={300} name={`end_${day}`} defaultValue={hours[day]?.end ?? ""} aria-label={`${WEEKDAY_NAMES[day]} end`} className={`${inputClass} w-32! py-1.5`} />
                {errors.days?.[day] && <span className="text-sm text-danger">{errors.days[day]}</span>}
              </div>
            ))}
          </section>
        )}

        {!staffId && (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
            <input type="checkbox" name="invite" value="1" defaultChecked className={checkboxClass} />
            Email them an invite to sign in (they choose their own password)
          </label>
        )}

        <button type="submit" className={buttonClass("primary", "lg", "self-start")}>
          {pending ? "Saving…" : staffId ? "Save changes" : "Add to the team"}
        </button>
      </fieldset>
    </form>
  );
}
