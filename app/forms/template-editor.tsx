"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { checkboxClass, fieldClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { FIELD_LABELS, type FieldType, type FormField, type FormRequirement } from "@/lib/forms";
import { saveTemplate } from "./actions";

export type TemplateDraft = { id?: string; name: string; intro: string; fields: FormField[]; required: FormRequirement; serviceIds: string[]; isActive: boolean };
export type ServiceOption = { id: string; name: string; category: string };

let nextKey = 0;
const newField = (type: FieldType = "yes_no"): FormField & { key: number } => ({ key: nextKey++, id: "", type, label: "", required: type === "signature" });

export function TemplateEditor({ initial, services, readOnly }: { initial: TemplateDraft; services: ServiceOption[]; readOnly: boolean }) {
  const [name, setName] = useState(initial.name);
  const [intro, setIntro] = useState(initial.intro);
  const [fields, setFields] = useState(() => (initial.fields.length ? initial.fields.map((f) => ({ ...f, key: nextKey++ })) : [newField("text"), newField("signature")]));
  const [required, setRequired] = useState(initial.required);
  const [serviceIds, setServiceIds] = useState(new Set(initial.serviceIds));
  const [isActive, setIsActive] = useState(initial.isActive);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (key: number, change: Partial<FormField>) => setFields((all) => all.map((f) => (f.key === key ? { ...f, ...change } : f)));
  const move = (i: number, by: number) =>
    setFields((all) => {
      const next = [...all];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const r = await saveTemplate({ id: initial.id, name, intro, fields: fields.map((f) => ({ id: f.id, type: f.type, label: f.label, required: f.required })), required, serviceIds: [...serviceIds], isActive });
      if (r && !r.ok) setMessage(r.message);
    });
  }

  const categories = [...new Set(services.map((s) => s.category))];

  return (
    <form onSubmit={submit} aria-label="Form template" className="flex flex-col gap-6">
      {message && <Alert>{message}</Alert>}
      <fieldset disabled={readOnly || pending} className="flex flex-col gap-6">
        <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
          <label className="flex flex-col gap-1.5 text-13 font-medium text-ink">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-13 font-medium text-ink">
            Introduction for the client (optional)
            <textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={2} maxLength={2000} className={fieldClass} />
          </label>
        </section>

        <section aria-label="Questions" className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-ink">Questions</h2>
          {fields.map((f, i) => (
            <div key={f.key} role="group" aria-label={`Question ${i + 1}`} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
              <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-medium text-ink">
                Question
                <input value={f.label} onChange={(e) => update(f.key, { label: e.target.value })} maxLength={300} className={fieldClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-13 font-medium text-ink">
                Type
                <select value={f.type} onChange={(e) => update(f.key, { type: e.target.value as FieldType, required: e.target.value === "signature" || f.required })} className={`${selectClass} w-40!`}>
                  {Object.entries(FIELD_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 pb-2.5 text-sm">
                <input type="checkbox" className={checkboxClass} checked={f.required} disabled={f.type === "signature"} onChange={(e) => update(f.key, { required: e.target.checked })} />
                Required
              </label>
              <div className="flex gap-1 pb-1">
                <Button type="button" variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move question ${i + 1} up`}>
                  ↑
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label={`Move question ${i + 1} down`}>
                  ↓
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setFields(fields.filter((x) => x.key !== f.key))} aria-label={`Remove question ${i + 1}`}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {(Object.keys(FIELD_LABELS) as FieldType[]).map((t) => (
              <Button key={t} type="button" size="sm" onClick={() => setFields([...fields, newField(t)])}>
                + {FIELD_LABELS[t]}
              </Button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-base font-semibold text-ink">When it&apos;s needed</h2>
          {(
            [
              ["none", "Optional: fill in whenever"],
              ["first_visit", "Before a client's first visit"],
              ["services", "Before certain services"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="required" checked={required === v} onChange={() => setRequired(v)} />
              {label}
            </label>
          ))}
          {required === "services" && (
            <div className="grid max-h-72 animate-fade-in gap-x-6 gap-y-1 overflow-y-auto rounded-lg border border-line p-3 sm:grid-cols-2" role="group" aria-label="Services that need this form">
              {categories.map((c) => (
                <div key={c} className="contents">
                  <p className="pt-2 text-xs font-medium text-ink-muted sm:col-span-2">{c}</p>
                  {services
                    .filter((s) => s.category === c)
                    .map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={serviceIds.has(s.id)}
                          onChange={(e) => {
                            const next = new Set(serviceIds);
                            if (e.target.checked) next.add(s.id);
                            else next.delete(s.id);
                            setServiceIds(next);
                          }}
                        />
                        {s.name}
                      </label>
                    ))}
                </div>
              ))}
            </div>
          )}
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" className={checkboxClass} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            In use
          </label>
        </section>
      </fieldset>
      <div className="flex items-center gap-3">
        {!readOnly && (
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            {pending ? "Saving…" : initial.id ? "Save form" : "Create form"}
          </Button>
        )}
        <Link href="/forms" className={buttonClass("ghost", "lg", "text-ink-muted")}>
          {readOnly ? "Back to forms" : "Cancel"}
        </Link>
      </div>
    </form>
  );
}
