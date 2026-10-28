"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, textLinkClass } from "@/components/ui/page";
import { Popover } from "@/components/ui/popover";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute } from "@/lib/scheduling/time";
import { outPanelHref, outside, sameShifts, sayShifts, shiftProblem, shown, sortShifts, type Cell, type Shift } from "@/lib/team-schedule";
import type { GridPerson } from "@/lib/team-schedule-load";
import { ShiftsField } from "./shifts-field";

// One person's day, in a popover on the shift (or the empty day) that
// opened it: their shifts (a split shift is two), saved to the week's
// draft. Clients booked outside the new hours are listed first, with the
// Mark out panel to move them once the week is published.
export function DayEditor({ anchor, cell, person, open, pending, onClose, onSave }: { anchor: HTMLElement; cell: Cell; person: GridPerson; open: Shift[]; pending: boolean; onClose: () => void; onSave: (shifts: Shift[]) => void }) {
  const [shifts, setShifts] = useState<Shift[]>(shown(cell));
  const problem = shiftProblem(shifts);
  const sorted = sortShifts(shifts);
  const left = problem ? [] : outside(cell, sorted).filter((b) => !outside(cell, cell.live).includes(b));
  const title = `${person.firstName} · ${formatDay(cell.date)}`;
  return (
    <Popover anchor={anchor} label={title} onClose={onClose} className="w-[22rem]">
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="-mt-2 text-13 text-ink-muted">
          Published: {sayShifts(cell.live)}
          {open.length === 0 && " · The salon is closed this day."}
        </p>
        <ShiftsField label={title} shifts={shifts} open={open} onChange={setShifts} compact />
        {cell.timeOff.length > 0 && <p className="text-13 text-ink-muted">{person.firstName} has approved time off this day; those hours can&rsquo;t be booked.</p>}
        {problem && (
          <p className="text-sm text-danger" role="alert">
            {problem}
          </p>
        )}
        {left.length > 0 && (
          <Alert tone="warning">
            {left.length} {left.length === 1 ? "client is" : "clients are"} booked outside these hours:{" "}
            {left.map((b) => `${b.client} at ${formatMinute(b.start)}`).join(", ")}. Once you publish, move them with{" "}
            <Link href={outPanelHref({ staffId: cell.staffId, date: cell.date, before: cell.live, after: sorted })} className={textLinkClass}>
              Mark {person.firstName} out
            </Link>
            .
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          {cell.draft ? (
            <Button variant="quiet" size="sm" className="-ml-3" onClick={() => setShifts(cell.live)}>
              Back to published
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending || Boolean(problem) || sameShifts(sorted, shown(cell))} onClick={() => onSave(sorted)}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Popover>
  );
}
