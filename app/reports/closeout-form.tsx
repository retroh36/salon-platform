"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { centsToInput } from "@/lib/services";
import { saveCloseout, type CloseoutResult } from "./actions";

export function CloseoutForm({ day, counted, note }: { day: string; counted: number | null; note: string }) {
  const [amount, setAmount] = useState(counted === null ? "" : centsToInput(counted));
  const [text, setText] = useState(note);
  const [result, setResult] = useState<CloseoutResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Close out the day"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveCloseout(day, amount, text)));
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          Cash counted ($)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${fieldClass} w-36`} required />
        </label>
        <label className={`${labelClass} min-w-48 flex-1`}>
          Note (optional)
          <input value={text} onChange={(e) => setText(e.target.value)} className={fieldClass} maxLength={500} />
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          Save count
        </Button>
      </div>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
