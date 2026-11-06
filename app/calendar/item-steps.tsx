"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useUnsavedChanges } from "@/components/unsaved";
import { StepsEditor } from "@/app/services/steps-editor";
import { reach } from "@/lib/reach";
import { formatMinute } from "@/lib/scheduling/time";
import { parseSteps, type Step } from "@/lib/scheduling/steps";
import { changeVisitSteps } from "./actions";

// A service built from steps on a visit: each step and its time, and, for
// those who book, Edit steps to change this visit's own (a longer
// processing, a step added or taken out).
export function ItemSteps({ itemId, start, steps, canEdit }: { itemId: string; start: number; steps: readonly Step[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useUnsavedChanges(editing);

  // Each step's start and end, one after another from the service's start.
  const timed = steps.map((s, n) => {
    const from = start + steps.slice(0, n).reduce((sum, x) => sum + x.minutes, 0);
    return { ...s, from, to: from + s.minutes };
  });

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    let next: Step[] | null = null;
    try {
      next = parseSteps(JSON.parse(String(new FormData(e.currentTarget).get("steps"))));
    } catch {
      next = null;
    }
    if (!next) return setMessage("Check each step has a name and minutes.");
    startTransition(async () => {
      const r = await reach(changeVisitSteps(itemId, next));
      if (!r.ok) return setMessage(r.message);
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <form onSubmit={save} className="mt-1 flex flex-col gap-3" aria-label="Edit steps">
        <StepsEditor initial={[...steps]} />
        {message && <p className="text-13 text-danger">{message}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save steps"}
          </Button>
          <Button size="sm" variant="quiet" onClick={() => (setEditing(false), setMessage(null))}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-ink-muted">
      <p data-testid="item-steps" className="min-w-0 tabular-nums">
        {timed.map((s) => `${s.name} ${formatMinute(s.from)}–${formatMinute(s.to)}`).join(" · ")}
      </p>
      {canEdit && (
        <Button variant="quiet" size="xs" className="-mr-2.5" onClick={() => setEditing(true)}>
          Edit steps
        </Button>
      )}
    </div>
  );
}
