"use client";

import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { CloseIcon } from "@/components/ui/icons";
import { minuteToTime, parseTime } from "@/lib/scheduling/time";
import { newShift, type Shift } from "@/lib/team-schedule";

// A day's shifts as time fields: a start and end for each, a second for a
// split shift (up to 4), and none for a day off.
export function ShiftsField({ label, shifts, open, onChange, compact = false }: { label: string; shifts: Shift[]; open: Shift[]; onChange: (shifts: Shift[]) => void; compact?: boolean }) {
  const set = (i: number, edge: "start" | "end", value: string) => {
    const m = parseTime(value);
    if (m == null) return;
    onChange(shifts.map((s, j) => (j === i ? { ...s, [edge]: m } : s)));
  };
  const next = shifts.length < 4 ? newShift(shifts, open) : null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{label}</legend>
      {shifts.length === 0 && <p className="text-sm text-ink-muted">Off</p>}
      {shifts.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="time"
            step={300}
            aria-label={`${label}: shift ${i + 1} starts`}
            className={`${fieldClass} ${compact ? "w-28" : "w-32"}`}
            value={minuteToTime(s.start)}
            onChange={(e) => set(i, "start", e.target.value)}
          />
          <span className="text-ink-muted">to</span>
          <input
            type="time"
            step={300}
            aria-label={`${label}: shift ${i + 1} ends`}
            className={`${fieldClass} ${compact ? "w-28" : "w-32"}`}
            value={minuteToTime(s.end === 1440 ? 1439 : s.end)}
            onChange={(e) => set(i, "end", e.target.value)}
          />
          <Button variant="quiet" size="sm" aria-label={`Remove shift ${i + 1}`} onClick={() => onChange(shifts.filter((_, j) => j !== i))}>
            <CloseIcon className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1">
        {next && (
          <Button variant="quiet" size="sm" className="-ml-3" onClick={() => onChange([...shifts, next])}>
            {shifts.length ? "+ Add split shift" : "+ Add a shift"}
          </Button>
        )}
        {shifts.length > 0 && (
          <Button variant="quiet" size="sm" onClick={() => onChange([])}>
            Day off
          </Button>
        )}
      </div>
    </fieldset>
  );
}
