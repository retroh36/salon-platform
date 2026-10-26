"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SignaturePad } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import type { Answers, FormField } from "@/lib/forms";
import { submitForm } from "../../forms-actions";

// A form for the client to fill in and sign on the front desk iPad: large
// controls, one column, then a thank-you screen to hand the iPad back.
export function FillForm({
  clientId,
  clientName,
  template,
  back,
}: {
  clientId: string;
  clientName: string;
  template: { id: string; name: string; intro: string | null; fields: FormField[] };
  back: string;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>({});
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; missing: string[] } | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  // Answering a question clears its "still needed" mark.
  const answered = (label: string) => setError((e) => e && { ...e, missing: e.missing.filter((m) => m !== label) });
  const set = (id: string, v: string | boolean) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    answered(template.fields.find((f) => f.id === id)!.label);
  };

  if (done) {
    return (
      <div className="flex animate-fade-in flex-col items-center gap-4 rounded-lg border border-line bg-surface p-10 text-center">
        <p className="text-2xl font-semibold text-ink">Thank you, {clientName.split(" ")[0]}!</p>
        <p className="text-base text-ink-muted">Please hand the iPad back to the front desk.</p>
        <Button variant="primary" size="lg" onClick={() => router.push(back)}>
          Done
        </Button>
      </div>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await submitForm(clientId, template.id, answers, signature);
      if (r.ok) setDone(true);
      else setError({ message: r.message, missing: r.missing ?? [] });
    });
  }

  return (
    <form onSubmit={submit} aria-label={template.name} className="flex flex-col gap-4 text-base">
      {template.intro && <p className="text-ink-muted">{template.intro}</p>}
      {template.fields.map((f) => {
        const missing = error?.missing.includes(f.label);
        const box = `flex flex-col gap-3 rounded-lg border bg-surface p-4 ${missing ? "border-danger" : "border-line"}`;
        const title = (
          <>
            {f.label}
            {f.required && f.type !== "signature" && <span className="text-danger"> *</span>}
          </>
        );
        if (f.type === "checkbox")
          return (
            <label key={f.id} className={`${box} flex-row! items-start`}>
              <input type="checkbox" className={`${checkboxClass} mt-1 size-6!`} checked={answers[f.id] === true} onChange={(e) => set(f.id, e.target.checked)} />
              <span>{title}</span>
            </label>
          );
        if (f.type === "yes_no")
          return (
            <fieldset key={f.id} className={box}>
              <legend className="sr-only">{f.label}</legend>
              <p aria-hidden>{title}</p>
              <div className="flex gap-3">
                {(["yes", "no"] as const).map((v) => (
                  <label
                    key={v}
                    className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 py-3 font-semibold transition-colors duration-(--motion-fast) ${answers[f.id] === v ? "border-navy-900 bg-navy-100 text-navy-900" : "border-line text-ink"}`}
                  >
                    <input type="radio" name={f.id} value={v} className="sr-only" checked={answers[f.id] === v} onChange={() => set(f.id, v)} />
                    {v === "yes" ? "Yes" : "No"}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        if (f.type === "signature")
          return (
            <div key={f.id} className={box}>
              <p className="font-medium">{f.label}</p>
              <SignaturePad
                label={f.label}
                onChange={(d) => {
                  setSignature(d);
                  if (d) answered(f.label);
                }}
              />
            </div>
          );
        return (
          <label key={f.id} className={box}>
            <span>{title}</span>
            <textarea rows={3} className={`${fieldClass} text-base`} value={String(answers[f.id] ?? "")} onChange={(e) => set(f.id, e.target.value)} />
          </label>
        );
      })}
      {error && (
        <Alert>
          {error.message}
          {error.missing.length > 0 && <span className="block">Still needed: {error.missing.join("; ")}</span>}
        </Alert>
      )}
      <Button type="submit" variant="primary" size="lg" disabled={pending} className="py-4 text-base">
        {pending ? "Saving…" : "Sign and submit"}
      </Button>
    </form>
  );
}
