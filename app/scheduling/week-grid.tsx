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

// A shift's times, short enough for a bar: "9–5", "9:30–1".
const short = (m: number) => {
  const h = Math.floor(m / 60) % 12 || 12;
  return m % 60 ? `${h}:${String(m % 60).padStart(2, "0")}` : String(h);
};
const barText = (s: Shift) => `${short(s.start)}–${short(s.end)}`;
// A day's total, to the nearest hour: "54 hr".
const hours = (m: number) => (m < 30 ? "0 hr" : formatDuration(Math.round(m / 60) * 60));

// The times on a bar; a narrow one shows when it starts.
function BarText({ shift }: { shift: Shift }) {
  return (
    <>
      <span aria-hidden className="hidden @[2.75rem]:inline">
        {barText(shift)}
      </span>
      <span aria-hidden className="@[2.75rem]:hidden">
        {short(shift.start)}
      </span>
    </>
  );
}

type Drag = {
  staffId: string;
  date: LocalDate;
  index: number;
  mode: "move" | "start" | "end";
  x0: number;
  width: number;
  moved: boolean;
  // The preview: the day it'd land on and that day's shifts, and the
  // source day's shifts once it's left.
  target: LocalDate;
  preview: Shift[] | null;
  source: Shift[] | null;
};

// The team's week: a row per person (stylists, assistants, front desk,
// then owners and managers with hours), a column per day, shifts as bars on
// each day's track. Owners and managers click a day to edit it, drag a bar
// to move it (to another day too) or its ends to resize it; every change
// goes to the week's draft until they publish. Everyone else sees what's
// published, read-only.
export function WeekGridView({ grid, today, editable }: { grid: WeekGrid; today: LocalDate; editable: boolean }) {
  const router = useRouter();
  const [base, setBase] = useState(grid);
  const [cells, setCells] = useState(() => new Map(grid.cells.map((c) => [cellKey(c.staffId, c.date), c])));
  if (base !== grid) {
    setBase(grid);
    setCells(new Map(grid.cells.map((c) => [cellKey(c.staffId, c.date), c])));
  }
  const [editing, setEditing] = useState<Cell | null>(null);
  const [pattern, setPattern] = useState<GridPerson | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string; moves?: { label: string; href: string }[] } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [pending, start] = useTransition();

  const all = [...cells.values()];
  const range = trackRange(Object.values(grid.open).flat(), all.flatMap(shown));
  const span = range.end - range.start;
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

  // Dragging: the pointer's move along the track, in minutes, and the day
  // under it.
  function onPointerDown(e: React.PointerEvent, cell: Cell, index: number, mode: Drag["mode"]) {
    if (!canEdit(cell.date) || e.button !== 0) return;
    e.stopPropagation();
    const track = (e.currentTarget as HTMLElement).closest("[data-cell]") as HTMLElement;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const d: Drag = { staffId: cell.staffId, date: cell.date, index, mode, x0: e.clientX, width: track.getBoundingClientRect().width, moved: false, target: cell.date, preview: null, source: null };
    dragRef.current = d;
    setDrag(d);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 4) return;
    const cell = cells.get(cellKey(d.staffId, d.date))!;
    const shifts = shown(cell);
    let target = d.date;
    if (d.mode === "move") {
      const over = document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset?.cell !== undefined) as HTMLElement | undefined;
      if (over?.dataset.staff === d.staffId && over.dataset.date && canEdit(over.dataset.date)) target = over.dataset.date;
    }
    const delta = (dx / d.width) * span;
    let preview: Shift[] | null;
    let source: Shift[] | null = null;
    if (target === d.date) {
      preview = dragShift(shifts, d.index, d.mode, target === d.date ? delta : 0, range);
    } else {
      const moved = dragShift([shifts[d.index]], 0, "move", 0, range)![0];
      preview = dropOnDay(shown(cells.get(cellKey(d.staffId, target))!), moved);
      source = shifts.filter((_, i) => i !== d.index);
    }
    const next = { ...d, moved: true, target, preview, source };
    dragRef.current = next;
    setDrag(next);
  }
  function onPointerUp(cell: Cell) {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (!d.moved) {
      setEditing(cell);
      return;
    }
    if (!d.preview) {
      setNotice({ tone: "error", text: "That shift doesn't fit there." });
      return;
    }
    save(d.target === d.date ? [{ staffId: d.staffId, date: d.date, shifts: d.preview }] : [
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

  const shiftsIn = (cell: Cell): Shift[] => {
    if (drag?.moved && drag.staffId === cell.staffId) {
      if (drag.target === cell.date && drag.preview) return drag.preview;
      if (drag.date === cell.date && drag.source) return drag.source;
    }
    return shown(cell);
  };

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
                    <p className="text-xs text-ink-muted">Salon closed</p>
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
                          className={`relative h-14 border-b border-l border-line ${closed ? "bg-off-hours" : ""} ${drag?.moved && drag.staffId === p.id && drag.target === cell.date ? "bg-active-soft/60" : ""}`}
                        >
                          {editableDay && (
                            <button
                              type="button"
                              className="absolute inset-0 rounded-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus hover:bg-sunken/60"
                              aria-label={`Edit ${p.firstName}'s hours on ${formatDay(cell.date)}: ${sayShifts(shown(cell))}`}
                              onClick={() => setEditing(cell)}
                            />
                          )}
                          {/* Approved time off: a hatched strip under the shifts, where it falls. */}
                          {cell.timeOff.map((t, i) => {
                            const start = Math.max(t.start, range.start);
                            const end = Math.min(t.end, range.end);
                            return end > start ? (
                              <span
                                key={`off-${i}`}
                                aria-hidden
                                title="Approved time off"
                                data-testid="time-off"
                                className="pointer-events-none absolute bottom-1 h-1.5 rounded-full bg-[repeating-linear-gradient(135deg,var(--color-ink-subtle)_0_2px,transparent_2px_5px)]"
                                style={{ left: `${((start - range.start) / span) * 100}%`, width: `${((end - start) / span) * 100}%` }}
                              />
                            ) : null;
                          })}
                          {cell.timeOff.length > 0 && <span className="sr-only">Approved time off</span>}
                          {shifts.length === 0 && !closed && !editableDay && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs text-ink-subtle">Off</span>}
                          {shifts.map((s, i) => {
                            const label = `${p.firstName}, ${formatDay(cell.date)}, ${formatMinute(s.start)}–${formatMinute(s.end)}${draft ? ", draft" : ""}`;
                            const style = { left: `${((s.start - range.start) / span) * 100}%`, width: `${((s.end - s.start) / span) * 100}%` };
                            const barClass = `@container absolute top-2.5 flex h-8 items-center justify-center overflow-hidden rounded-md border px-0.5 text-xs font-medium tabular-nums whitespace-nowrap ${
                              draft ? "border-dashed border-active bg-active-soft text-active-ink" : "border-navy-200 bg-navy-100 text-navy-900"
                            }`;
                            return editableDay ? (
                              <button
                                key={i}
                                type="button"
                                aria-label={label}
                                title={label}
                                data-shift
                                className={`${barClass} z-[1] cursor-grab touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus active:cursor-grabbing`}
                                style={style}
                                onPointerDown={(e) => onPointerDown(e, cell, i, "move")}
                                onPointerMove={onPointerMove}
                                onPointerUp={() => onPointerUp(cell)}
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
                                  if (e.detail === 0) setEditing(cell);
                                }}
                              >
                                <span
                                  aria-hidden
                                  className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                                  data-edge="start"
                                  onPointerDown={(e) => onPointerDown(e, cell, i, "start")}
                                />
                                <BarText shift={s} />
                                <span
                                  aria-hidden
                                  className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                                  data-edge="end"
                                  onPointerDown={(e) => onPointerDown(e, cell, i, "end")}
                                />
                              </button>
                            ) : (
                              <span key={i} className={barClass} style={style} title={label} data-shift>
                                <BarText shift={s} />
                              </span>
                            );
                          })}
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
          ? "Dashed shifts are drafts: nobody sees them until you publish the week. Drag a shift to move it, or its ends to change its times."
          : "Shows the published schedule."}
        {" "}Scheduled is shifts less approved time off (hatched); booked is time with clients.
      </p>

      {editing && (
        <DayEditor
          key={cellKey(editing.staffId, editing.date)}
          cell={cells.get(cellKey(editing.staffId, editing.date)) ?? editing}
          person={grid.people.find((p) => p.id === editing.staffId)!}
          open={grid.open[editing.date] ?? []}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(shifts) => save([{ staffId: editing.staffId, date: editing.date, shifts }], () => setEditing(null))}
        />
      )}
      {pattern && <PatternEditor person={pattern} week={grid.week} onClose={() => setPattern(null)} />}
      {publishing && (
        <PublishSheet
          changes={changes}
          people={grid.people}
          pending={pending}
          onClose={() => setPublishing(false)}
          onPublish={() =>
            start(async () => {
              const r = await publishWeek(grid.week);
              setPublishing(false);
              if (!r.ok) setNotice({ tone: "error", text: r.message });
              else {
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

