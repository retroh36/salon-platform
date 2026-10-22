"use client";

import { useState, useTransition } from "react";
import { recordItemTime } from "@/app/calendar/actions";
import { useNow } from "@/app/calendar/now-line";
import { Button } from "@/components/ui/button";
import { formatMinutes } from "@/lib/services";
import { actualMinutes, EVENT_LABELS, nextEvents, sinceMinutes, timerState, type ItemTimes, type TimeEvent } from "@/lib/visit-times";

const STATE_TEXT = {
  waiting: "Not started",
  in_chair: "In the chair",
  processing: "Processing",
  finishing: "Back in the chair",
  done: "Done",
} as const;

// One-tap times for a service: Started, Processing, Back in chair,
// Finished, with Undo. Big targets, for a stylist's phone.
export function ServiceTimer({
  itemId,
  times,
  hasProcessing,
  bookedMinutes,
  canRecord,
  big = false,
}: {
  itemId: string;
  times: ItemTimes;
  hasProcessing: boolean;
  bookedMinutes: number;
  canRecord: boolean;
  big?: boolean;
}) {
  const now = useNow();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const state = timerState(times);
  const events = canRecord ? nextEvents(times, hasProcessing) : [];
  const actual = actualMinutes(times);
  const since = state === "processing" ? times.processingStartedAt : state === "in_chair" ? times.startedAt : state === "finishing" ? times.processingEndedAt : null;

  const tap = (event: TimeEvent) =>
    start(async () => {
      setError(null);
      const result = await recordItemTime(itemId, event);
      if (!result.ok) setError(result.message);
    });

  let status: string = STATE_TEXT[state];
  if (actual !== null) {
    const diff = actual - bookedMinutes;
    status = `Done in ${formatMinutes(actual)}${Math.abs(diff) >= 3 ? ` · ${formatMinutes(Math.abs(diff))} ${diff > 0 ? "over" : "under"}` : ""}`;
  } else if (since && now !== null) {
    status = `${STATE_TEXT[state]} · ${formatMinutes(sinceMinutes(since, now))}`;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="service-timer" data-state={state}>
      <p className="text-sm text-ink-muted" aria-live="polite">
        {status}
      </p>
      {events.length > 0 && (
        <div className={`grid gap-2 ${events.length > 1 ? "grid-cols-2" : ""}`}>
          {events.map((e, i) => (
            <Button key={e} variant={i === 0 ? "primary" : "secondary"} size={big ? "lg" : "md"} disabled={pending} onClick={() => tap(e)} className={big ? "min-h-12" : ""}>
              {EVENT_LABELS[e]}
            </Button>
          ))}
        </div>
      )}
      {canRecord && state !== "waiting" && (
        <button type="button" disabled={pending} onClick={() => tap("undo")} className="self-start text-sm font-medium text-link underline-offset-2 hover:text-link-hover hover:underline">
          Undo last tap
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
