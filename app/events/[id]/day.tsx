"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { shrinkPhoto } from "@/lib/photos";
import { addLookPhoto, bookTrial, completeEvent, saveLook, trialTimes, type DayResult, type TrialTime } from "../day-actions";

function Status({ result }: { result: DayResult | null }) {
  if (!result) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-ink-muted" : "font-medium text-danger"}`}>
      {result.message}
    </p>
  );
}

// Completing the event: asked first, then one sale for payroll.
export function CompleteEvent({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<DayResult | null>(null);
  const [pending, start] = useTransition();
  if (!asking)
    return (
      <Button variant="primary" size="md" onClick={() => setAsking(true)}>
        Complete event
      </Button>
    );
  return (
    <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Complete event">
      <span className="text-sm">The team&rsquo;s work, tips and fees go to payroll.</span>
      <Button
        variant="primary"
        size="md"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await completeEvent(eventId);
            setResult(r);
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Completing…" : "Yes, complete it"}
      </Button>
      <Button variant="ghost" size="md" onClick={() => setAsking(false)}>
        Not yet
      </Button>
      <Status result={result} />
    </span>
  );
}

// Book the trial: a day, then the free times (the event's hair team first).
export function TrialBooker({ eventId, defaultDate, minDate }: { eventId: string; defaultDate: string; minDate: string }) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [times, setTimes] = useState<TrialTime[] | null>(null);
  const [result, setResult] = useState<DayResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Book trial"
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => {
          const r = await trialTimes(eventId, date);
          if (r.ok) setTimes(r.times);
          else setResult(r);
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Trial day
          <input type="date" value={date} min={minDate} onChange={(e) => setDate(e.target.value)} className={`${fieldClass} w-44`} />
        </label>
        <Button type="submit" variant="secondary" disabled={pending || !date}>
          {pending && !times ? "Looking…" : "Find times"}
        </Button>
      </div>
      {times && (
        <ul className="flex flex-wrap gap-2" aria-label="Free times">
          {times.length === 0 && <li className="text-sm text-ink-muted">Nobody&rsquo;s free that day. Try another.</li>}
          {times.map((t) => (
            <li key={`${t.staffId}-${t.start}`}>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await bookTrial(eventId, t.staffId, t.start);
                    setResult(r);
                    if (r.ok) {
                      setTimes(null);
                      router.refresh();
                    }
                  })
                }
              >
                {t.label}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Status result={result} />
    </form>
  );
}

// The look's notes, saved as you type.
export function LookNotes({ eventId, initial }: { eventId: string; initial: string }) {
  const [notes, setNotes] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState("saving");
    const timer = setTimeout(async () => setState((await saveLook(eventId, notes)).ok ? "saved" : "error"), 600);
    return () => clearTimeout(timer);
  }, [eventId, notes]);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="look-notes" className="text-sm font-medium">
        Notes on the look
      </label>
      <textarea
        id="look-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder="Low textured bun, face-framing pieces, pins in the left side; soft glam, matte lip…"
        className={`${fieldClass} h-auto py-2`}
      />
      <p className="h-5 text-xs text-ink-muted" aria-live="polite">
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Couldn't save. Try again." : ""}
      </p>
    </div>
  );
}

export function LookPhotoUpload({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [result, setResult] = useState<DayResult | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Photo of the look"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          start(async () => {
            const form = new FormData();
            form.set("photo", await shrinkPhoto(file), "look.jpg");
            const r = await addLookPhoto(eventId, form);
            setResult(r);
            if (r.ok) router.refresh();
          });
        }}
      />
      <Button size="sm" variant="secondary" className="self-start" disabled={pending} onClick={() => input.current?.click()}>
        {pending ? "Saving…" : "Add photo"}
      </Button>
      <Status result={result} />
    </div>
  );
}
