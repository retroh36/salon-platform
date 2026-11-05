"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { parseDollars } from "@/lib/checkout";
import { centsToInput, formatPrice } from "@/lib/services";
import { saveCloseout, type CloseoutResult } from "./actions";

// The drawer count: the day's starting float (the opening count, else the
// salon's usual one, unless changed for the day), the cash that should be
// there with it, what was counted, and the deposit to the bank (the rest
// is what tomorrow's opening count is checked against).
export function CloseoutForm({ day, cashNetCents, floatCents, counted, note, deposit }: { day: string; cashNetCents: number; floatCents: number; counted: number | null; note: string; deposit: number | null }) {
  const [float, setFloat] = useState(centsToInput(floatCents));
  const [amount, setAmount] = useState(counted === null ? "" : centsToInput(counted));
  const [text, setText] = useState(note);
  const [bank, setBank] = useState(deposit ? centsToInput(deposit) : "");
  const [result, setResult] = useState<CloseoutResult | null>(null);
  const [pending, start] = useTransition();
  const floatNow = parseDollars(float || "0");
  return (
    <form
      aria-label="Close out the day"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveCloseout(day, amount, text, float, bank)));
      }}
    >
      <p>
        Cash expected in the drawer:{" "}
        <strong className="tabular-nums" data-testid="expected-cash">
          {floatNow === null ? "—" : formatPrice(floatNow + cashNetCents)}
        </strong>
        <span className="text-ink-muted"> ({floatNow === null ? "enter the float" : `${formatPrice(floatNow)} float + ${formatPrice(cashNetCents)} cash`})</span>
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          Starting float ($)
          <input inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} className={`${fieldClass} w-32`} />
        </label>
        <label className={labelClass}>
          Cash counted ($)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${fieldClass} w-36`} required />
        </label>
        <label className={labelClass}>
          Deposit to the bank ($)
          <input inputMode="decimal" value={bank} onChange={(e) => setBank(e.target.value)} className={`${fieldClass} w-36`} placeholder="0" />
        </label>
        <label className={`${labelClass} min-w-48 flex-1`}>
          Note (optional)
          <input value={text} onChange={(e) => setText(e.target.value)} className={fieldClass} maxLength={500} />
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          Save count
        </Button>
      </div>
      {parseDollars(amount) !== null && parseDollars(bank || "0") !== null && (
        <p className="text-13 text-ink-muted" data-testid="left-in-drawer">
          Left in the drawer for tomorrow: {formatPrice(Math.max(0, parseDollars(amount)! - parseDollars(bank || "0")!))}
        </p>
      )}
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
