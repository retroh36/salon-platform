"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { savePin, type PinResult } from "./actions";

// Owners and managers use 6 digits (set_my_pin checks it); everyone else 4 to 6.
export function PinForm({ hasPin, digits }: { hasPin: boolean; digits: 4 | 6 }) {
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [result, setResult] = useState<PinResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Your PIN"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await savePin(pin, again);
          setResult(r);
          if (r.ok) {
            setPin("");
            setAgain("");
          }
        });
      }}
    >
      <p className="text-sm text-ink-muted">{hasPin ? "You have a PIN. Enter a new one to change it." : "You don't have a PIN yet."}</p>
      <div className="flex flex-wrap gap-3">
        <label className={`${labelClass} w-40`}>
          {hasPin ? "New PIN" : "PIN"}
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} type="password" inputMode="numeric" autoComplete="off" minLength={digits} maxLength={6} required className={fieldClass} />
        </label>
        <label className={`${labelClass} w-40`}>
          PIN again
          <input value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))} type="password" inputMode="numeric" autoComplete="off" minLength={digits} maxLength={6} required className={fieldClass} />
        </label>
      </div>
      <p className="text-xs text-ink-muted">{digits === 6 ? "6 digits" : "4 to 6 digits"}, not all the same and not a run like 1234.</p>
      <Button type="submit" variant="primary" className="self-start" disabled={pending}>
        Save PIN
      </Button>
      {result && (result.ok ? <p role="status" className="text-sm font-medium text-status-confirmed-ink">{result.message}</p> : <Alert>{result.message}</Alert>)}
    </form>
  );
}
