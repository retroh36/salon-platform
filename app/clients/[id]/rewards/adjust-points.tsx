"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { useCloseCardAction } from "../side-card";
import { adjustPoints } from "./actions";

// Adds or takes off points, with a reason (logged with who did it), opened
// from the Rewards card's corner; saving closes it, saying the new balance.
export function AdjustPoints({ clientId }: { clientId: string }) {
  const close = useCloseCardAction();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Adjust points"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await adjustPoints(clientId, delta, reason);
          if (r.ok) close(r.message);
          else setResult(r);
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
        <Button size="sm" variant="quiet" onClick={() => close()}>
          Cancel
        </Button>
      </div>
      {result && <Alert>{result.message}</Alert>}
    </form>
  );
}
