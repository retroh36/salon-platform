"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClass } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, RepeatIcon, WarningIcon } from "@/components/ui/icons";
import { Alert, Badge, nameLinkClass, textLinkClass } from "@/components/ui/page";
import { formatDuration } from "@/lib/duration";
import { formatDay } from "@/lib/schedule-format";
import { addDays, formatMinute, type LocalDate } from "@/lib/scheduling/time";
import {
  cellKey,
  changesOf,
  clearWeek,
  copyWeek,
  dayTotals,
  dragShift,
  dropOnDay,
  outside,
  patternLabel,
  ROLE_GROUPS,
  sayShifts,
  scheduledMinutes,
  shown,
  trackRange,
  withEdit,
  type Cell,
  type DayEdit,
  type Shift,
} from "@/lib/team-schedule";
import type { GridPerson, WeekGrid } from "@/lib/team-schedule-load";
import { discardWeek, publishWeek, saveDays } from "./actions";
import { DayEditor } from "./day-editor";
import { PatternEditor } from "./pattern-editor";
import { PublishSheet } from "./publish-sheet";

// A shift's times, short enough for a pill but always both ends: "9–5",
// "9:30–1".
const short = (m: number) => {
  const h = Math.floor(m / 60) % 12 || 12;
  return m % 60 ? `${h}:${String(m % 60).padStart(2, "0")}` : String(h);
};
const pillText = (s: Shift) => `${short(s.start)}–${short(s.end)}`;
// A day's total, to the nearest hour: "54 hr".
const hours = (m: number) => (m < 30 ? "0 hr" : formatDuration(Math.round(m / 60) * 60));
// Approved time off in a day: "Time off" when it covers the day's hours,
// else "Off 2–6".
const offText = (t: Shift, day: Shift[]) => (day.length === 0 || day.every((d) => t.start <= d.start && t.end >= d.end) ? "Time off" : `Off ${pillText(t)}`);

// A shift being dragged to another day in its row.
type Drag = {
  staffId: string;
  date: LocalDate;
  index: number;
  x0: number;
  y0: number;
  moved: boolean;
  // The day under the pointer, and both days' shifts if it's dropped there.
  target: LocalDate;
  preview: Shift[] | null;
  source: Shift[] | null;
};

// The team's week: a row per person (stylists, assistants, front desk,
// then owners and managers with hours), a column per day, each day's shifts
// as pills with their times, side by side (stacked when there's no room).
// Owners and managers click a shift or an empty day to edit it in a
// popover, or drag a shift onto another day in the row; every change goes
// to the week's draft until they publish. Everyone else sees what's
// published, read-only.
export function WeekGridView({ grid, today, editable }: { grid: WeekGrid; today: LocalDate; editable: boolean }) {
  const router = useRouter();
  const [base, setBase] = useState(grid);
  const [cells, setCells] = useState(() => new Map(grid.cells.map((c) => [cellKey(c.staffId, c.date), c])));
  if (base !== grid) {
    setBase(grid);
    setCells(new Map(grid.cells.map((c) => [cellKey(c.staffId, c.date), c])));
  }
  const [editing, setEditing] = useState<{ cell: Cell; anchor: HTMLElement } | null>(null);
  const [pattern, setPattern] = useState<GridPerson | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string; moves?: { label: string; href: string }[] } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [pending, start] = useTransition();

  const all = [...cells.values()];
  const range = trackRange(Object.values(grid.open).flat(), all.flatMap(shown));
  const changes = changesOf(all);
  const canEdit = (date: LocalDate) => editable && date >= today;

  function save(edits: DayEdit[], after?: () => void) {
    if (!edits.length) return;
    const before = cells;
    const next = new Map(cells);
    for (const e of edits) {
      const c = next.get(cellKey(e.staffId, e.date));
      if (c) next.set(cellKey(e.staffId, e.date), withEdit(c, e.shifts));
    }
    setCells(next);
    setNotice(null);
    start(async () => {
      const r = await saveDays(edits);
      if (!r.ok) {
        setCells(before);
        setNotice({ tone: "error", text: r.message });
      } else {
        after?.();
        router.refresh();
      }
    });
  }

  function week(action: () => Promise<{ ok: boolean; message?: string }>) {
    setNotice(null);
    start(async () => {
      const r = await action();
      if (!r.ok) setNotice({ tone: "error", text: r.message ?? "That didn't save." });
      else router.refresh();
    });
  }

  // Dragging a shift onto another day in the row; a press without moving
  // opens it.
  function onPointerDown(e: React.PointerEvent, cell: Cell, index: number) {
    if (!canEdit(cell.date) || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const d: Drag = { staffId: cell.staffId, date: cell.date, index, x0: e.clientX, y0: e.clientY, moved: false, target: cell.date, preview: null, source: null };
    dragRef.current = d;
    setDrag(d);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
    const shifts = shown(cells.get(cellKey(d.staffId, d.date))!);
    const over = document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset?.cell !== undefined) as HTMLElement | undefined;
    const target = over?.dataset.staff === d.staffId && over.dataset.date && canEdit(over.dataset.date) ? over.dataset.date : d.date;
    const next: Drag =
      target === d.date
        ? { ...d, moved: true, target, preview: null, source: null }
        : { ...d, moved: true, target, preview: dropOnDay(shown(cells.get(cellKey(d.staffId, target))!), shifts[d.index]), source: shifts.filter((_, i) => i !== d.index) };
    dragRef.current = next;
    setDrag(next);
  }
  function onPointerUp(e: React.PointerEvent, cell: Cell) {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (!d.moved) {
      setEditing({ cell, anchor: e.currentTarget as HTMLElement });
      return;
    }
    if (d.target === d.date) return;
    if (!d.preview) {
      setNotice({ tone: "error", text: "That shift doesn't fit there." });
      return;
    }
    save([
      { staffId: d.staffId, date: d.date, shifts: d.source ?? [] },
      { staffId: d.staffId, date: d.target, shifts: d.preview },
    ]);
  }
  function onKeyDown(e: React.KeyboardEvent, cell: Cell, index: number) {
    if (!canEdit(cell.date) || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const next = dragShift(shown(cell), index, e.shiftKey ? "end" : "move", e.key === "ArrowLeft" ? -15 : 15, range);
    if (next) save([{ staffId: cell.staffId, date: cell.date, shifts: next }]);
  }

  // While a shift is dragged, the day under the pointer shows where it'd
  // go; its own day keeps it (faded), so the pill being held stays put.
  const shiftsIn = (cell: Cell): Shift[] => (drag?.moved && drag.staffId === cell.staffId && drag.target !== drag.date && drag.target === cell.date && drag.preview ? drag.preview : shown(cell));
  const held = (cell: Cell, i: number) => Boolean(drag?.moved && drag.staffId === cell.staffId && drag.date === cell.date && drag.index === i && drag.target !== drag.date);

  const drafts = changes.length;
  const status = drafts ? (
    <Badge tone="warning">
      Draft · {drafts} {drafts === 1 ? "change" : "changes"}
    </Badge>
  ) : grid.lastPublished ? (
    <Badge tone="success">Published {formatDay(grid.lastPublished.at.slice(0, 10))}</Badge>
  ) : (
    <Badge tone="neutral">Follows everyone&rsquo;s pattern</Badge>
  );
  const groups = ROLE_GROUPS.map((g) => ({
    ...g,
    people: grid.people.filter((p) => g.roles.includes(p.role) && (g.always || grid.dates.some((d) => shown(cells.get(cellKey(p.id, d))!).length > 0))),
  })).filter((g) => g.people.length > 0);

  return (
    <div data-testid="team-schedule">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/scheduling?week=${addDays(grid.week, -7)}`} className={buttonClass("secondary", "sm", "", { square: true })} aria-label="Previous week">
            <ChevronLeftIcon className="size-4" />
          </Link>
          <Link href="/scheduling" className={buttonClass("secondary", "sm")}>
            This week
          </Link>
          <Link href={`/scheduling?week=${addDays(grid.week, 7)}`} className={buttonClass("secondary", "sm", "", { square: true })} aria-label="Next week">
            <ChevronRightIcon className="size-4" />
          </Link>
          <h2 className="ml-1 text-base font-semibold text-ink">Week of {formatDay(grid.week, true)}</h2>
          {editable ? status : grid.lastPublished && <Badge tone="success">Published</Badge>}
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            {drafts > 0 && (
              <Button variant="quiet" size="sm" disabled={pending} onClick={() => week(() => discardWeek(grid.week))}>
                Discard changes
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => {
                const edits = copyWeek(grid.lastWeek, all, grid.dates.map((d) => ({ from: addDays(d, -7), to: d }))).filter((e) => canEdit(e.date));
                if (edits.length) save(edits);
                else setNotice({ tone: "success", text: "This week already matches last week." });
              }}
            >
              Copy last week
            </Button>
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => save(clearWeek(all).filter((e) => canEdit(e.date)))}>
              Clear week
            </Button>
            <Button size="sm" disabled={pending || drafts === 0} onClick={() => setPublishing(true)}>
              Publish week
            </Button>
          </div>
        )}
      </div>

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone === "error" ? "error" : "success"}>
            {notice.text}
            {notice.moves?.length ? (
              <ul className="mt-2 flex flex-col gap-1">
                {notice.moves.map((m) => (
                  <li key={m.href}>
                    <Link href={m.href} className={textLinkClass}>
                      {m.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        </div>
      )}

      <div className="overflow-x-auto overscroll-x-contain rounded-xl border border-line bg-surface">
        <div role="grid" aria-label={`Team schedule, week of ${formatDay(grid.week, true)}`} className="grid min-w-[60rem] grid-cols-[15rem_repeat(7,minmax(7rem,1fr))]">
          <div role="row" className="contents">
            <div role="columnheader" className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-3 text-13 font-medium text-ink-muted">
              Team
            </div>
            {grid.dates.map((d) => {
              const totals = dayTotals(all.filter((c) => c.date === d));
              const closed = grid.open[d].length === 0;
              return (
                <div key={d} role="columnheader" className={`border-b border-l border-line px-3 py-2.5 ${d === today ? "bg-active-soft" : ""}`} data-day={d}>
                  <p className={`text-sm font-semibold ${d === today ? "text-active-ink" : "text-ink"}`}>{formatDay(d)}</p>
                  {closed ? (
                    <p className="text-xs text-ink-muted">Closed</p>
                  ) : (
                    <p className="text-xs text-ink-muted tabular-nums" data-testid="day-totals">
                      <span className="block">{hours(totals.scheduled)} scheduled</span>
                      <span className="block">{hours(totals.booked)} booked</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {groups.map((g) => (
            <div key={g.key} role="rowgroup" aria-label={g.label} className="contents">
              <div role="row" className="contents">
                <div role="rowheader" className="sticky left-0 z-10 col-span-8 border-b border-line bg-sunken px-4 py-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  {g.label}
                </div>
              </div>
              {g.people.map((p) => {
                const row = grid.dates.map((d) => cells.get(cellKey(p.id, d))!);
                const total = row.reduce((n, c) => n + scheduledMinutes(c), 0);
                return (
                  <div key={p.id} role="row" className="contents" data-person={p.id}>
                    <div role="rowheader" className="sticky left-0 z-10 flex items-center gap-2.5 border-b border-line bg-surface px-4 py-2">
                      <Avatar name={p.name} color={p.color} level={p.level} photoUrl={p.photoUrl} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/schedule?staff=${p.id}`} className={`${nameLinkClass} block truncate text-sm`}>
                          {p.name}
                        </Link>
                        <p className="truncate text-xs text-ink-muted tabular-nums">
                          {hours(total)}
                          {p.chair && <span data-testid="home-chair"> · {p.chair}</span>}
                        </p>
                      </div>
                      {editable && (
                        <Button
                          variant="quiet"
                          size="xs"
                          className="-mr-2 shrink-0 gap-1"
                          onClick={() => setPattern(p)}
                          aria-label={`${p.firstName}'s repeating pattern${p.cycleWeeks > 1 ? `, ${patternLabel(p.cycleWeeks).toLowerCase()}` : ""}`}
                          title={p.cycleWeeks > 1 ? patternLabel(p.cycleWeeks) : "Repeating pattern"}
                        >
                          <RepeatIcon className="size-4" />
                          {p.cycleWeeks > 1 && (
                            <span aria-hidden className="text-xs tabular-nums" data-testid="pattern-weeks">
                              {p.cycleWeeks} wk
                            </span>
                          )}
                        </Button>
                      )}
                    </div>
                    {row.map((cell) => {
                      const shifts = shiftsIn(cell);
                      const draft = cell.draft !== null;
                      const left = outside(cell, shown(cell));
                      const closed = grid.open[cell.date].length === 0;
                      const editableDay = canEdit(cell.date);
                      return (
                        <div
                          key={cell.date}
                          role="gridcell"
                          data-cell
                          data-staff={p.id}
                          data-date={cell.date}
                          data-draft={draft || undefined}
                          data-closed={closed || undefined}
                          className={`relative min-w-0 border-b border-l border-line ${drag?.moved && drag.staffId === p.id && drag.target === cell.date ? "bg-active-soft/60" : ""}`}
                        >
                          {editableDay && (
                            <button
                              type="button"
                              className="absolute inset-0 rounded-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus hover:bg-sunken/60"
                              aria-label={`Edit ${p.firstName}'s hours on ${formatDay(cell.date)}: ${sayShifts(shown(cell))}`}
                              onClick={(e) => setEditing({ cell, anchor: e.currentTarget })}
                            />
                          )}
                          {/* The day's shifts as pills, left to right (wrapping
                              when there's no room); the cell's own button
                              shows through the gaps. */}
                          <div className={`pointer-events-none relative flex min-h-14 flex-wrap content-center items-center gap-1 py-1.5 pl-1.5 ${left.length ? "pr-5" : "pr-1.5"}`}>
                            {shifts.map((s, i) => {
                              const label = `${p.firstName}, ${formatDay(cell.date)}, ${formatMinute(s.start)}–${formatMinute(s.end)}${draft ? ", draft" : ""}`;
                              const pillClass = `inline-flex h-7 max-w-full min-w-0 items-center rounded-md border px-2 text-xs font-medium tabular-nums whitespace-nowrap ${
                                draft ? "border-dashed border-active bg-active-soft text-active-ink" : "border-navy-200 bg-navy-100 text-navy-900"
                              }`;
                              const text = (
                                <span aria-hidden className="truncate">
                                  {pillText(s)}
                                </span>
                              );
                              return editableDay ? (
                                <button
                                  key={i}
                                  type="button"
                                  aria-label={label}
                                  title={label}
                                  data-shift
                                    className={`${pillClass} ${held(cell, i) ? "opacity-40" : ""} pointer-events-auto cursor-grab touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus active:cursor-grabbing`}
                                  onPointerDown={(e) => onPointerDown(e, cell, i)}
                                  onPointerMove={onPointerMove}
                                  onPointerUp={(e) => onPointerUp(e, cell)}
                                  onPointerCancel={() => {
                                    dragRef.current = null;
                                    setDrag(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape" && dragRef.current) {
                                      dragRef.current = null;
                                      setDrag(null);
                                    } else onKeyDown(e, cell, i);
                                  }}
                                  onClick={(e) => {
                                    // Keyboard Enter or Space (the pointer opens it on release).
                                    if (e.detail === 0) setEditing({ cell, anchor: e.currentTarget });
                                  }}
                                >
                                  {text}
                                </button>
                              ) : (
                                <span key={i} className={pillClass} title={label} data-shift>
                                  {text}
                                </span>
                              );
                            })}
                            {/* Approved time off: a small tag, never on a day the salon's closed. */}
                            {!closed &&
                              cell.timeOff.map((t, i) => (
                                <span key={`off-${i}`} title="Approved time off" data-testid="time-off" className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 px-1 text-xs text-ink-muted">
                                  <span aria-hidden className="size-3 shrink-0 rounded-sm bg-[repeating-linear-gradient(135deg,var(--color-ink-subtle)_0_2px,transparent_2px_4px)]" />
                                  <span className="truncate">{offText(t, grid.open[cell.date])}</span>
                                </span>
                              ))}
                            {grid.lentChairs[cellKey(cell.staffId, cell.date)] && (
                              <span className="inline-flex h-7 max-w-full min-w-0 items-center px-1 text-[11px] font-medium text-active-ink" data-testid="lent-chair">
                                <span className="truncate">{grid.lentChairs[cellKey(cell.staffId, cell.date)]}</span>
                              </span>
                            )}
                            {shifts.length === 0 && cell.timeOff.length === 0 && !closed && !editableDay && <span className="px-1.5 text-xs text-ink-subtle">Off</span>}
                          </div>
                          {left.length > 0 && (
                            <span
                              className="pointer-events-none absolute top-1 right-1 z-[2] text-warning"
                              title={`${left.length} ${left.length === 1 ? "client" : "clients"} booked outside these hours`}
                              data-testid="clients-outside"
                            >
                              <WarningIcon className="size-3.5" />
                              <span className="sr-only">
                                {left.length} {left.length === 1 ? "client" : "clients"} booked outside these hours
                              </span>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {editable
          ? "Dashed shifts are drafts: nobody sees them until you publish the week. Click a shift or a day to change it, or drag a shift onto another day."
          : "Shows the published schedule."}
        {" "}Scheduled is shifts less approved time off; booked is time with clients.
      </p>

      {editing && (
        <DayEditor
          key={cellKey(editing.cell.staffId, editing.cell.date)}
          anchor={editing.anchor}
          cell={cells.get(cellKey(editing.cell.staffId, editing.cell.date)) ?? editing.cell}
          person={grid.people.find((p) => p.id === editing.cell.staffId)!}
          open={grid.open[editing.cell.date] ?? []}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(shifts) => {
            const { staffId, date } = editing.cell;
            setEditing(null);
            save([{ staffId, date, shifts }]);
          }}
        />
      )}
      {pattern && <PatternEditor person={pattern} week={grid.week} onClose={() => setPattern(null)} />}
      {publishing && (
        <PublishSheet
          changes={changes}
          people={grid.people}
          pending={pending}
          onClose={() => setPublishing(false)}
          onPublish={(moveClients) =>
            start(async () => {
              const r = await publishWeek(grid.week);
              setPublishing(false);
              if (!r.ok) setNotice({ tone: "error", text: r.message });
              else if (moveClients && r.moves.length) {
                // The rest stay listed here for when they come back.
                setNotice({ tone: "success", text: r.message, moves: r.moves });
                router.push(r.moves[0].href);
              } else {
                setNotice({ tone: "success", text: r.message, moves: r.moves });
                router.refresh();
              }
            })
          }
        />
      )}
    </div>
  );
}

