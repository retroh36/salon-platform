"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { adjustPoints } from "./actions";

// Adds or takes off points, with a reason (logged with who did it).
export function AdjustPoints({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Adjust points
      </Button>
    );
  return (
    <form
      aria-label="Adjust points"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await adjustPoints(clientId, delta, reason);
          setResult(r);
          if (r.ok) {
            setDelta("");
            setReason("");
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <label className={labelClass}>
          Points
          <input inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} className={fieldClass} placeholder="50 or -50" required />
        </label>
        <label className={labelClass}>
          Why
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} maxLength={200} placeholder="e.g. Points from an old card" required />
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          Save
        </Button>
        <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </form>
  );
}
