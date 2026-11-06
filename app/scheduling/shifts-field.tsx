"use client";

import { Button } from "@/components/ui/button";
import { fieldClass, selectClass } from "@/components/ui/field";
import { CloseIcon } from "@/components/ui/icons";
import { minuteToTime, parseTime } from "@/lib/scheduling/time";
import { newShift, type Shift } from "@/lib/team-schedule";

// A day's shifts as time fields: a start and end for each, a second for a
// split shift (up to 4), and none for a day off. With working roles, each
// shift says which role it's in.
export function ShiftsField({
  label,
  shifts,
  open,
  onChange,
  roles = [],
  compact = false,
}: {
  label: string;
  shifts: Shift[];
  open: Shift[];
  onChange: (shifts: Shift[]) => void;
  roles?: { id: string; name: string }[];
  compact?: boolean;
}) {
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
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
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
          {roles.length > 0 && (
            <select
              aria-label={`${label}: shift ${i + 1} role`}
              className={`${selectClass} ${compact ? "w-[15.5rem]" : "w-[16.5rem]"}`}
              value={s.role ?? ""}
              onChange={(e) => onChange(shifts.map((x, j) => (j === i ? withRole(x, e.target.value || null) : x)))}
            >
              <option value="">No role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              {s.role && !roles.some((r) => r.id === s.role) && <option value={s.role}>A role they no longer work</option>}
            </select>
          )}
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

// The shift with this role (none: no `role` at all, so it reads the same as
// a shift that never had one).
function withRole(shift: Shift, role: string | null): Shift {
  const times = { start: shift.start, end: shift.end };
  return role ? { ...times, role } : times;
}
