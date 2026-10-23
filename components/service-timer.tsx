"use client";

import { useState, useTransition } from "react";
import { recordItemTime } from "@/app/calendar/actions";
import { Button } from "@/components/ui/button";
import { EVENT_LABELS, nextEvents, timerState, timerStatus, type ItemTimes, type TimeEvent } from "@/lib/visit-times";

// One-tap times for a service: Start service, Processing, Back in chair,
// Finish service, with Undo, under its status in words ("In service since
// 10:52am"). Big targets, for a stylist's phone. In booking details the
// next tap may be the panel's one primary button (`omit`), and the rest
// here are secondary (`quiet`).
export function ServiceTimer({
  itemId,
  times,
  hasProcessing,
  bookedMinutes,
  canRecord,
  timeZone,
  big = false,
  omit = null,
  quiet = false,
}: {
  itemId: string;
  times: ItemTimes;
  hasProcessing: boolean;
  bookedMinutes: number;
  canRecord: boolean;
  timeZone: string;
  big?: boolean;
  omit?: TimeEvent | null;
  // Secondary buttons only: the panel has the one primary action.
  quiet?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const state = timerState(times);
  const events = canRecord ? nextEvents(times, hasProcessing).filter((e) => e !== omit) : [];

  const tap = (event: TimeEvent) =>
    start(async () => {
      setError(null);
      const result = await recordItemTime(itemId, event);
      if (!result.ok) setError(result.message);
    });

  const status = timerStatus(times, bookedMinutes, timeZone);

  return (
    <div className="flex flex-col gap-2" data-testid="service-timer" data-state={state}>
      <p className="text-sm text-ink-muted" aria-live="polite">
        {status}
      </p>
      {events.length > 0 && (
        <div className={quiet ? "flex flex-wrap gap-2" : `grid gap-2 ${events.length > 1 ? "grid-cols-2" : ""}`}>
          {events.map((e, i) => (
            <Button
              key={e}
              variant={i === 0 && !quiet ? "primary" : "secondary"}
              size={big ? "lg" : quiet ? "sm" : "md"}
              disabled={pending}
              onClick={() => tap(e)}
              className={big ? "min-h-12" : "whitespace-nowrap"}
            >
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
