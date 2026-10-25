"use client";

import { Button } from "@/components/ui/button";
import type { Lane, TimelineTask } from "@/lib/scheduling/events";
import { formatMinute } from "@/lib/scheduling/time";

const KIND_LABELS = { hair: "Hair", makeup: "Makeup", touch_up: "Touch-ups" } as const;

// The day in time order: who's in which chair when, back from the ready-by
// time.
export function TimelineEditor({
  tasks,
  readyBy,
  nameOf,
  staffOf,
  manual,
  onReset,
}: {
  tasks: TimelineTask[];
  readyBy: number;
  nameOf: (key: string) => string;
  staffOf: (lane: Lane) => string | null;
  onChange: (tasks: TimelineTask[]) => void;
  manual: boolean;
  onReset: () => void;
}) {
  const touchUps = tasks.filter((t) => t.kind === "touch_up");
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col divide-y divide-line text-sm" aria-label="Timeline" data-testid="timeline">
        {tasks
          .filter((t) => t.kind !== "touch_up")
          .map((t, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2 py-1.5">
              <span className="tabular-nums text-ink-muted">
                {formatMinute(t.start)}–{formatMinute(t.end)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {nameOf(t.member!)} · {KIND_LABELS[t.kind]}
              </span>
              <span className="shrink-0 text-ink-muted">{staffOf(t) ?? `${KIND_LABELS[t.role]} ${t.lane}`}</span>
            </li>
          ))}
        {touchUps.length > 0 && (
          <li className="flex items-baseline justify-between gap-2 py-1.5">
            <span className="tabular-nums text-ink-muted">
              {formatMinute(touchUps[0].start)}–{formatMinute(readyBy)}
            </span>
            <span className="flex-1 font-medium">Touch-ups</span>
          </li>
        )}
        <li className="flex justify-between py-1.5 font-semibold">
          <span>Ready by {formatMinute(readyBy)}</span>
        </li>
      </ol>
      {manual && (
        <Button size="sm" onClick={onReset} className="self-start">
          Work it out again
        </Button>
      )}
    </div>
  );
}
