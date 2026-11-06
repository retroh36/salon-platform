"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { countDrawer, type DrawerResult } from "./actions";

// A blind count: what's in the drawer, without being told what it should
// be first. `onDone`: once it's saved (the checkout's Cash sheet goes on).
export function CountForm({ kind, onDone }: { kind: "open" | "mid"; onDone?: (message: string) => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<DrawerResult | null>(null);
  const [pending, start] = useTransition();
  const label = kind === "open" ? "Opening count" : "Count the drawer";
  return (
    <form
      aria-label={label}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await countDrawer(kind, amount, note);
          setResult(r);
          if (r.ok) {
            setAmount("");
            setNote("");
            onDone?.(r.message);
          }
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          Cash counted ($)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${fieldClass} w-36`} required />
        </label>
        <label className={`${labelClass} min-w-48 flex-1`}>
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} maxLength={300} />
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save count"}
        </Button>
      </div>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
