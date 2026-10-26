"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import type { PatchSettings } from "@/lib/scheduling/patch-tests";
import { savePatchSettings } from "./actions";

export function PatchSettingsForm({ initial, readOnly }: { initial: PatchSettings; readOnly: boolean }) {
  const [months, setMonths] = useState(String(Math.round(initial.validDays / 30.4)));
  const [hours, setHours] = useState(String(initial.minHours));
  const [enforcement, setEnforcement] = useState(initial.enforcement);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const r = await savePatchSettings({ validDays: Math.round(Number(months) * 30.4), minHours: Number(hours), enforcement });
      setMessage(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.message });
    });
  }

  return (
    <form onSubmit={submit} aria-label="Patch test rules" className="flex flex-col gap-4">
      <fieldset disabled={readOnly || pending} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex items-center gap-2">
            Valid for
            <input type="number" min={1} max={36} value={months} onChange={(e) => setMonths(e.target.value)} className={`${fieldClass} w-20!`} aria-label="Months a patch test is valid" />
            months
          </label>
          <label className="flex items-center gap-2">
            Done at least
            <input type="number" min={0} max={336} value={hours} onChange={(e) => setHours(e.target.value)} className={`${fieldClass} w-20!`} aria-label="Hours before the service" />
            hours before the service
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="font-medium text-ink">When a client&apos;s patch test is missing, expired or too recent</p>
          <label className="flex items-center gap-2">
            <input type="radio" name="enforcement" checked={enforcement === "warn"} onChange={() => setEnforcement("warn")} />
            Warn, but allow the booking
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="enforcement" checked={enforcement === "block"} onChange={() => setEnforcement("block")} />
            Don&apos;t allow the booking
          </label>
        </div>
      </fieldset>
      {message && (message.ok ? <p role="status" className="text-sm text-ink-muted">{message.text}</p> : <Alert>{message.text}</Alert>)}
      {!readOnly && (
        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save patch test rules"}
          </Button>
        </div>
      )}
    </form>
  );
}
