"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { GRACE_FIELDS, graceMessage, graceProblem, MAX_GRACE_MESSAGE, type GraceSettings } from "@/lib/policy";
import { saveGrace, type PolicyResult } from "./actions";

// Settings → Policies → Grace: forgive a client's first no-show (or late
// cancellation) in a window, at once or once they rebook with the same
// stylist, and the message they get, in the salon's own words.
export function GraceForm({ initial, salon, bookingUrl }: { initial: GraceSettings; salon: string; bookingUrl: string }) {
  const [on, setOn] = useState(initial.on);
  const [kinds, setKinds] = useState(initial.kinds);
  const [months, setMonths] = useState(String(initial.months));
  const [rebook, setRebook] = useState(initial.rebookDays !== null);
  const [days, setDays] = useState(String(initial.rebookDays ?? 14));
  const [message, setMessage] = useState(initial.message);
  const [result, setResult] = useState<PolicyResult | null>(null);
  const [pending, start] = useTransition();

  const grace: GraceSettings = { on, kinds, months: Number(months), rebookDays: rebook ? Number(days) : null, message };
  const problem = graceProblem(grace);
  const preview = graceMessage(message, { firstName: "Ava", salon, stylist: "Bridget", by: "Fri, Nov 20", bookingLink: bookingUrl });
  const toggle = (kind: GraceSettings["kinds"][number], checked: boolean) => {
    setKinds((k) => (checked ? [...k.filter((x) => x !== kind), kind] : k.filter((x) => x !== kind)));
    setResult(null);
  };

  return (
    <form
      aria-label="Grace"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveGrace(grace)));
      }}
    >
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" className={checkboxClass} checked={on} onChange={(e) => (setOn(e.target.checked), setResult(null))} />
        Give clients grace for their first missed visit
      </label>

      {on && (
        <div className="flex flex-col gap-4 border-l border-line pl-4">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-13 font-medium text-ink">For</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className={checkboxClass} checked={kinds.includes("no_show")} onChange={(e) => toggle("no_show", e.target.checked)} />
              No-shows
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className={checkboxClass} checked={kinds.includes("late_cancel")} onChange={(e) => toggle("late_cancel", e.target.checked)} />
              Late cancellations
            </label>
          </fieldset>

          <label className={`${labelClass} max-w-xs`}>
            Once every (months)
            <input inputMode="numeric" value={months} onChange={(e) => (setMonths(e.target.value), setResult(null))} className={`${fieldClass} w-24`} />
            <span className="text-13 font-normal text-ink-muted">A client gets grace at most once in this time.</span>
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-13 font-medium text-ink">The fee</legend>
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="grace_rebook" checked={!rebook} onChange={() => (setRebook(false), setResult(null))} />
              Waive it straight away
            </label>
            <label className="flex min-h-9 flex-wrap items-center gap-2 text-sm">
              <input type="radio" name="grace_rebook" checked={rebook} onChange={() => (setRebook(true), setResult(null))} />
              Waive it if they rebook with the same stylist within
              <input aria-label="Days to rebook" inputMode="numeric" value={days} disabled={!rebook} onChange={(e) => (setDays(e.target.value), setResult(null))} className={`${fieldClass} w-20`} />
              days, else charge it
            </label>
          </fieldset>

          <label className={labelClass}>
            Message to the client
            <textarea value={message} maxLength={MAX_GRACE_MESSAGE} onChange={(e) => (setMessage(e.target.value), setResult(null))} rows={3} className={`${fieldClass} field-sizing-content`} />
            <span className="text-13 font-normal text-ink-muted">
              Never sent by itself: booking details and Denise ask the front desk to send it or not, on the client&rsquo;s channel for visit messages. It can use {GRACE_FIELDS.map((f) => `{${f}}`).join(", ")}.
            </span>
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-13 font-medium text-ink">How it reads</span>
            <p data-testid="grace-preview" className="rounded-lg border border-line bg-sunken p-3 text-sm whitespace-pre-wrap text-ink">
              {preview}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || (on && !!problem)}>
          {pending ? "Saving…" : "Save grace"}
        </Button>
        {on && problem && <span className="text-sm text-danger">{problem}</span>}
      </div>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
