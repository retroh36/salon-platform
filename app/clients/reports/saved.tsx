"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { removeReport, saveReport } from "./actions";

// Save the report on screen under a name (shared with the salon by those
// with reports).
export function SaveReport({ encoded, canShare, suggested }: { encoded: string; canShare: boolean; suggested: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveReport, null);
  if (!open)
    return (
      <Button onClick={() => setOpen(true)} data-testid="save-report">
        Save report
      </Button>
    );
  return (
    <form action={action} aria-label="Save report" className="flex w-full flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
      <input type="hidden" name="r" value={encoded} />
      <label className={`${labelClass} min-w-56 flex-1`}>
        Name
        <input name="name" required maxLength={80} defaultValue={suggested} className={fieldClass} autoFocus />
      </label>
      {canShare && (
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="shared" className={checkboxClass} />
          Share with the team
        </label>
      )}
      <Button type="submit" variant="primary" disabled={pending}>
        Save
      </Button>
      <Button variant="quiet" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {state?.error && <Alert className="w-full">{state.error}</Alert>}
    </form>
  );
}

export function RemoveReport({ id, name }: { id: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="quiet" size="sm" disabled={pending} aria-label={`Remove ${name}`} onClick={() => start(async () => setError((await removeReport(id))?.error ?? null))}>
        Remove
      </Button>
      {error && <span className="text-13 text-danger">{error}</span>}
    </>
  );
}
