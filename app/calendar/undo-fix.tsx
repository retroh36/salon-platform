"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UndoIcon } from "@/components/ui/icons";
import type { Told } from "@/lib/denise/applied";
import { reach } from "@/lib/reach";
import { undoWarning } from "./denise-actions";

// Undo for one of Denise's applied fixes, wherever it shows (her card, the
// fixes applied that day, a visit's History). When a moved client has
// already been messaged, it asks first ("Grace was told 3:05pm. Undo and
// send a correction?") with the correction each would get; undoing then
// leaves those corrections for staff to check and send (`told`).
export function UndoFix({ actionId, working, onUndo }: { actionId: string; working: boolean; onUndo: (actionId: string, told: string[]) => void }) {
  const [checking, setChecking] = useState(false);
  const [told, setTold] = useState<Told[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Whether anyone was told decides what Undo does, so it never guesses.
  async function check() {
    setChecking(true);
    setFailed(false);
    const found = await reach(undoWarning(actionId)).catch(() => null);
    setChecking(false);
    if (!Array.isArray(found)) setFailed(true);
    else if (found.length) setTold(found);
    else onUndo(actionId, []);
  }

  if (told) {
    const who = told.map((t) => `${t.firstName} was told ${t.at}.`).join(" ");
    return (
      <div role="group" aria-label="Undo this fix" data-testid="undo-warning" className="flex w-full flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-sm text-ink">
        <p className="font-medium">
          {who} Undo and send {told.length > 1 ? "corrections" : "a correction"}?
        </p>
        {told.map((t) => (
          <p key={t.appointmentId} data-testid="correction-preview" className="rounded-md bg-canvas px-3 py-2 text-13 whitespace-pre-line text-ink-muted">
            {t.preview.body}
          </p>
        ))}
        <p className="text-13 text-ink-muted">Nothing is sent until you send it.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={working} onClick={() => onUndo(actionId, told.map((t) => t.appointmentId))}>
            Undo and write the correction
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setTold(null)}>
            Keep it
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={check} disabled={working || checking}>
        <UndoIcon className="size-4" />
        Undo
      </Button>
      {failed && <p className="text-13 text-danger">Couldn&rsquo;t check that just now. Try again.</p>}
    </div>
  );
}
