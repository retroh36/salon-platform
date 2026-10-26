"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { formatDay, formatLongDay } from "@/lib/schedule-format";
import { BLOCK_KINDS, BLOCK_LABELS, type BlockFormErrors } from "@/lib/scheduling/blocks";
import { formatMinute, minuteToTime, weekdayOf, type LocalDate } from "@/lib/scheduling/time";
import { deleteBlock, moveBlock, saveBlock } from "./block-actions";
import type { ColumnData, TimeBlockData } from "./types";
import { useUnsavedChanges } from "@/components/unsaved";

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

// "Every weekday", "Every Mon and Wed"
export function repeatLabel(weekdays: number[]): string {
  const set = [...weekdays].sort().join(",");
  if (set === "1,2,3,4,5") return "Every weekday";
  if (set === "1,2,3,4,5,6,7") return "Every day";
  const names = DAYS.filter(([d]) => weekdays.includes(d)).map(([, n]) => n);
  return `Every ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}`;
}

// Blocking time (lunch, a break, training, a meeting, personal time) for a
// stylist, once or repeating; or changing or removing a block.
export function BlockPanel({
  date,
  columns,
  staffChoices,
  block,
  start,
  onClose,
  onDone,
}: {
  date: LocalDate;
  columns: ColumnData[];
  // Whose time this person can block.
  staffChoices: string[];
  // Changing an existing block (this day's occurrence of it).
  block?: TimeBlockData;
  // A new block from a slot.
  start?: { staffId: string; startMinute: number };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const repeating = Boolean(block?.weekdays);
  const [editing, setEditing] = useState(!block);
  const [scope, setScope] = useState<"day" | "all">("day");
  const [staffId, setStaffId] = useState(block?.staffId ?? start?.staffId ?? staffChoices[0]);
  const [kind, setKind] = useState<string>(block?.kind ?? "lunch");
  const [note, setNote] = useState(block?.note ?? "");
  const [from, setFrom] = useState(minuteToTime(block?.start ?? start?.startMinute ?? 12 * 60));
  const [to, setTo] = useState(minuteToTime(block?.end ?? (start ? start.startMinute + 30 : 12 * 60 + 30)));
  const [repeat, setRepeat] = useState(repeating);
  const [weekdays, setWeekdays] = useState<number[]>(block?.weekdays ?? [weekdayOf(date)]);
  const [until, setUntil] = useState(block?.endsOn ?? "");
  const [errors, setErrors] = useState<BlockFormErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const name = (id: string) => columns.find((c) => c.staffId === id)?.name ?? "";
  // Changed since it opened: leaving asks first.
  const snapshot = JSON.stringify([scope, staffId, kind, note, from, to, repeat, weekdays, until]);
  const [opened] = useState(snapshot);
  useUnsavedChanges(snapshot !== opened);

  const run = (action: () => Promise<{ ok: boolean; message: string; errors?: BlockFormErrors }>) =>
    startTransition(async () => {
      setMessage(null);
      const r = await action();
      if (r.ok) onDone(r.message);
      else {
        setMessage(r.message);
        setErrors(r.errors ?? {});
      }
    });

  const save = () => {
    // A change to just this day of a repeating block is a move of that day.
    if (block && repeating && scope === "day") {
      const [h1, m1] = from.split(":").map(Number);
      const [h2, m2] = to.split(":").map(Number);
      return run(() => moveBlock({ blockId: block.blockId, staffId, date, startMinute: h1 * 60 + m1, endMinute: h2 * 60 + m2 }));
    }
    run(() =>
      saveBlock(
        { staffId, kind, note, start: from, end: to, date: block && repeating ? block.startsOn! : date, repeat, weekdays, until },
        block?.blockId ?? null,
      ),
    );
  };

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold text-ink">{block ? BLOCK_LABELS[block.kind] : "Block time"}</h2>
        <p className="text-ink-muted">{formatLongDay(date)}</p>
      </div>
    </div>
  );

  if (block && !editing) {
    return (
      <section aria-label="Blocked time" className="flex flex-col gap-4 py-2 text-sm">
        {header}
        <dl className="flex flex-col gap-2 border-y border-line py-4">
          <div>
            <dt className="sr-only">Who</dt>
            <dd className="font-medium text-ink">{name(block.staffId)}</dd>
          </div>
          <div>
            <dt className="sr-only">When</dt>
            <dd>
              {formatMinute(block.start)}–{formatMinute(block.end)}
              {block.weekdays && (
                <span className="block text-ink-muted" data-testid="block-repeat">
                  {repeatLabel(block.weekdays)}
                  {block.endsOn ? ` until ${formatDay(block.endsOn)}` : ""}
                </span>
              )}
            </dd>
          </div>
          {block.note && (
            <div>
              <dt className="sr-only">Note</dt>
              <dd className="text-ink">{block.note}</dd>
            </div>
          )}
        </dl>
        <p className="text-ink-muted">No one can be booked in this time. Drag it to move it, or its bottom edge to change its length.</p>
        {message && <Alert>{message}</Alert>}
        {staffChoices.includes(block.staffId) && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(true)}>Change</Button>
            {repeating ? (
              <>
                <Button variant="danger-quiet" disabled={pending} onClick={() => run(() => deleteBlock({ blockId: block.blockId, staffId: block.staffId, date, scope: "day" }))}>
                  Remove this day
                </Button>
                <Button variant="danger-quiet" disabled={pending} onClick={() => run(() => deleteBlock({ blockId: block.blockId, staffId: block.staffId, date, scope: "all" }))}>
                  Remove every day
                </Button>
              </>
            ) : (
              <Button variant="danger-quiet" disabled={pending} onClick={() => run(() => deleteBlock({ blockId: block.blockId, staffId: block.staffId, date, scope: "all" }))}>
                Remove
              </Button>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <form
      aria-label={block ? "Change blocked time" : "Block time"}
      className="flex flex-col gap-4 py-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {header}
      {message && <Alert>{message}</Alert>}
      {block && repeating && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-13 font-medium text-ink">Change</legend>
          {(["day", "all"] as const).map((v) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="scope" value={v} checked={scope === v} onChange={() => setScope(v)} />
              {v === "day" ? "This day only (just the time)" : "Every day it repeats"}
            </label>
          ))}
        </fieldset>
      )}
      <label className={labelClass}>
        Stylist
        <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={selectClass} disabled={Boolean(block)}>
          {staffChoices.map((id) => (
            <option key={id} value={id}>
              {name(id)}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        What for
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={selectClass} disabled={Boolean(block && repeating && scope === "day")}>
          {BLOCK_KINDS.map((k) => (
            <option key={k} value={k}>
              {BLOCK_LABELS[k]}
            </option>
          ))}
        </select>
        {errors.kind && <span className="text-xs font-normal text-danger">{errors.kind}</span>}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          From
          <input type="time" step={300} value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClass} required />
        </label>
        <label className={labelClass}>
          To
          <input type="time" step={300} value={to} onChange={(e) => setTo(e.target.value)} className={fieldClass} required />
        </label>
      </div>
      {errors.times && <p className="-mt-2 text-xs text-danger">{errors.times}</p>}
      {!(block && repeating && scope === "day") && (
        <>
          <label className="flex items-center gap-2 font-medium text-ink">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className={checkboxClass} disabled={Boolean(block)} />
            Repeats every week
          </label>
          {repeat && (
            <div className="flex animate-fade-in flex-col gap-3">
              <fieldset className="flex flex-wrap gap-1.5">
                <legend className="mb-1.5 text-13 font-medium text-ink">On</legend>
                {DAYS.map(([d, label]) => (
                  <label key={d} className="cursor-pointer">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={weekdays.includes(d)}
                      onChange={(e) => setWeekdays(e.target.checked ? [...weekdays, d] : weekdays.filter((w) => w !== d))}
                    />
                    <span className="inline-flex h-9 min-w-11 items-center justify-center rounded-md border border-line-strong bg-surface px-3 text-sm transition-colors duration-(--motion-fast) hover:bg-sunken peer-checked:border-navy-900 peer-checked:bg-navy-900 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
                      {label}
                    </span>
                  </label>
                ))}
              </fieldset>
              {errors.weekdays && <p className="-mt-1 text-xs text-danger">{errors.weekdays}</p>}
              <label className={labelClass}>
                <span>
                  Until <span className="font-normal text-ink-muted">(optional)</span>
                </span>
                <input type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} className={fieldClass} />
                {errors.until && <span className="text-xs font-normal text-danger">{errors.until}</span>}
              </label>
            </div>
          )}
          <label className={labelClass}>
            <span>
              Note <span className="font-normal text-ink-muted">(optional)</span>
            </span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Wella color class" className={fieldClass} />
          </label>
        </>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : block ? "Save" : "Block time"}
        </Button>
        <Button onClick={block ? () => setEditing(false) : onClose} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
