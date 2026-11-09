"use client";

// The quiz, then its match: the service and up to three stylists, each
// straight into the booking flow.

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { formatDuration } from "@/lib/duration";
import { shrinkPhoto } from "@/lib/photos";
import { formatPrice } from "@/lib/services";
import { BUDGETS, BUDGET_TEXT, CHANGES, CHANGE_TEXT, HISTORY, HISTORY_TEXT, LENGTHS, LENGTH_TEXT, MAX_QUIZ_NOTES, MAX_QUIZ_PHOTOS, type QuizAnswers } from "@/lib/stylist-quiz";
import { accentLink, buttonSpinner, inputClass, primaryButton, sectionTitle, secondaryButton } from "../styles";
import { StylistPhoto } from "../stylist-photo";
import { addQuizPhoto, submitQuiz, type QuizResult } from "./actions";

const chip = (on: boolean) => `flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm font-medium has-focus-visible:outline-2 has-focus-visible:outline-offset-2 ${on ? "border-(--accent) bg-(--accent-soft) text-ink" : "border-line-strong bg-surface text-ink"}`;

function Choices<T extends string>({ legend, name, options, value, onChange }: { legend: string; name: string; options: readonly { key: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink">{legend}</legend>
      {options.map((o) => (
        <label key={o.key} className={chip(value === o.key)}>
          <input type="radio" name={name} className="sr-only" checked={value === o.key} onChange={() => onChange(o.key)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

export function Quiz({ slug, categories }: { slug: string; categories: string[] }) {
  const [category, setCategory] = useState<string | null>(null);
  const [change, setChange] = useState<QuizAnswers["change"] | null>(null);
  const [length, setLength] = useState<QuizAnswers["length"] | null>(null);
  const [history, setHistory] = useState<QuizAnswers["history"]>([]);
  const [budget, setBudget] = useState<QuizAnswers["budget"]>("any");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<QuizResult, { ok: true }> | null>(null);
  const [pending, start] = useTransition();
  const honeypot = useRef<HTMLInputElement>(null);
  const ready = category && change && length;

  const send = () =>
    start(async () => {
      setError(null);
      const r = await submitQuiz(slug, { category, change, length, history, budget, notes }, honeypot.current?.value ?? "");
      if (!r.ok) return setError(r.message);
      for (const file of photos.slice(0, MAX_QUIZ_PHOTOS)) {
        const data = new FormData();
        data.set("photo", await shrinkPhoto(file), "photo.jpg");
        await addQuizPhoto(r.quizId, r.photoKey, data);
      }
      setResult(r);
      window.scrollTo({ top: 0 });
    });

  if (result) {
    const href = (staff: string) => `/book/${slug}?${new URLSearchParams({ services: result.service.id, staff, quiz: result.quizId })}#book`;
    return (
      <div className="flex flex-col gap-4" data-testid="quiz-result">
        <div>
          <h2 className={sectionTitle}>{result.consultation ? "Start with a consultation" : "We suggest"}</h2>
          <p className="mt-2 text-ink">
            <span className="font-medium">{result.service.name}</span> · {formatDuration(result.service.minutes)}
          </p>
          {result.consultation && <p className="mt-1 text-ink-muted">A change this big, over past treatments, is best planned in person first.</p>}
        </div>
        <ul className="flex flex-col gap-3">
          {result.stylists.map((s) => (
            <li key={s.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4" data-testid="quiz-stylist">
              <div className="flex items-center gap-3">
                <StylistPhoto name={s.name} url={s.photoUrl} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{s.name}</p>
                  <p className="text-13 text-ink-soft">{formatPrice(s.cents)}</p>
                </div>
              </div>
              {s.reasons.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-ink-muted">
                  {s.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              <Link href={href(s.id)} className={primaryButton}>
                Book with {s.name.split(" ")[0]}
              </Link>
            </li>
          ))}
        </ul>
        <Link href={`/book/${slug}`} className={accentLink}>
          See the whole menu instead
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] size-px" />
      <Choices legend="What are you looking for?" name="category" options={categories.map((c) => ({ key: c, label: c }))} value={category} onChange={setCategory} />
      <Choices legend="How much of a change?" name="change" options={CHANGES.map((key) => ({ key, label: CHANGE_TEXT[key] }))} value={change} onChange={setChange} />
      <Choices legend="Your hair length" name="length" options={LENGTHS.map((key) => ({ key, label: LENGTH_TEXT[key] }))} value={length} onChange={setLength} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">Has your hair had any of these?</legend>
        {HISTORY.map((h) => (
          <label key={h} className={chip(history.includes(h))}>
            <input type="checkbox" className="sr-only" checked={history.includes(h)} onChange={() => setHistory(history.includes(h) ? history.filter((x) => x !== h) : [...history, h])} />
            {HISTORY_TEXT[h]}
          </label>
        ))}
      </fieldset>
      <Choices legend="Price" name="budget" options={BUDGETS.map((key) => ({ key, label: BUDGET_TEXT[key] }))} value={budget} onChange={setBudget} />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Anything else we should know? (optional)
        <textarea value={notes} maxLength={MAX_QUIZ_NOTES} rows={3} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Photos of your hair or what you&rsquo;d like (optional, up to {MAX_QUIZ_PHOTOS})
        <input type="file" accept="image/*" multiple className={secondaryButton} onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, MAX_QUIZ_PHOTOS))} />
        <span className="font-normal text-ink-muted">Only the salon&rsquo;s team sees your photos.</span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button type="button" className={primaryButton} disabled={!ready || pending} onClick={send}>
        {pending ? <span className={buttonSpinner} aria-hidden /> : "See my match"}
      </button>
    </div>
  );
}
