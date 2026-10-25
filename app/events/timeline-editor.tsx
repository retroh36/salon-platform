"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { laneKey, laneSpans, moveTask, type Lane, type Lanes, type TimelineTask } from "@/lib/scheduling/events";
import { formatMinute } from "@/lib/scheduling/time";

const KIND_LABELS = { hair: "Hair", makeup: "Makeup", touch_up: "Touch-ups" } as const;
const ROLE_STYLE = {
  hair: "border-sky-accent bg-sky-fill",
  makeup: "border-rose-accent bg-rose-fill",
} as const;

type Drag = { index: number; x: number; y: number; from: TimelineTask; start: number; lane: number; moved: boolean };

// The day, back from the ready-by time: a row per artist, each person's
// hair and makeup as a bar. Drag a bar (or focus it and use the arrow
// keys: left and right for 5 minutes, up and down for another artist doing
// the same work) and everything is checked again as it moves: the
// timeline's own rules here, and who's free in the builder once the call
// times change. The list below says the same in words.
export function TimelineEditor({
  tasks,
  lanes,
  readyBy,
  nameOf,
  staffOf,
  problemsOf,
  onChange,
  manual,
  onReset,
}: {
  tasks: TimelineTask[];
  lanes: Lanes;
  readyBy: number;
  nameOf: (key: string) => string;
  staffOf: (lane: Lane) => string | null;
  problemsOf: (tasks: TimelineTask[]) => string[];
  onChange: (tasks: TimelineTask[]) => void;
  manual: boolean;
  onReset: () => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const shown = drag?.moved ? moveTask(tasks, drag.index, { start: drag.start, lane: drag.lane }, lanes) : tasks;
  const liveProblems = drag?.moved ? problemsOf(shown) : [];

  const spans = laneSpans(shown);
  const first = Math.min(...spans.map((s) => s.call), readyBy - 60);
  const from = Math.floor(first / 60) * 60;
  const to = Math.ceil((readyBy + 1) / 60) * 60;
  const range = to - from;
  const pct = (minute: number) => `${((minute - from) / range) * 100}%`;
  const hours = Array.from({ length: range / 60 + 1 }, (_, i) => from + i * 60);
  const laneRows: Lane[] = (["hair", "makeup"] as const).flatMap((role) => Array.from({ length: lanes[role] }, (_, i) => ({ role, lane: i + 1 })));

  const minutesPerPx = () => range / (track.current?.getBoundingClientRect().width || 1);
  const commit = (next: TimelineTask[]) => onChange(next);

  function onKey(e: React.KeyboardEvent, index: number) {
    const t = tasks[index];
    const step = e.shiftKey ? 15 : 5;
    const moves: Record<string, { start: number; lane?: number }> = {
      ArrowLeft: { start: t.start - step },
      ArrowRight: { start: t.start + step },
      ArrowUp: { start: t.start, lane: t.lane - 1 },
      ArrowDown: { start: t.start, lane: t.lane + 1 },
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    commit(moveTask(tasks, index, move, lanes));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto overscroll-x-contain" data-testid="timeline-chart">
        <div className="min-w-[32rem]">
          <div className="relative ml-28 h-5 text-xs text-ink-subtle" aria-hidden>
            {hours.map((h) => (
              <span key={h} className="absolute -translate-x-1/2 tabular-nums" style={{ left: pct(h) }}>
                {formatMinute(h)}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            {laneRows.map((lane) => {
              const key = laneKey(lane);
              const span = spans.find((s) => laneKey(s) === key);
              const who = staffOf(lane);
              return (
                <div key={key} className="flex items-center gap-2" data-lane-row={key}>
                  <div className="w-26 shrink-0 text-sm leading-tight">
                    <div className="truncate font-medium">{who ?? `${KIND_LABELS[lane.role]} ${lane.lane}`}</div>
                    <div className="text-xs text-ink-muted">{span ? `${KIND_LABELS[lane.role]} · call ${formatMinute(span.call)}` : KIND_LABELS[lane.role]}</div>
                  </div>
                  <div
                    ref={(el) => {
                      if (el) rows.current.set(key, el);
                      else rows.current.delete(key);
                      if (el && lane === laneRows[0]) track.current = el;
                    }}
                    className="relative h-11 flex-1 rounded-md bg-sunken"
                  >
                    {hours.map((h) => (
                      <span key={h} aria-hidden className="absolute inset-y-0 w-px bg-line" style={{ left: pct(h) }} />
                    ))}
                    <span aria-hidden className="absolute inset-y-0 w-0.5 bg-navy-900" style={{ left: pct(readyBy) }} />
                    {shown.map((t) => {
                      if (laneKey(t) !== key) return null;
                      const touchUp = t.kind === "touch_up";
                      const label = touchUp ? "Touch-ups" : `${nameOf(t.member!)} · ${KIND_LABELS[t.kind]}`;
                      const time = `${formatMinute(t.start)}–${formatMinute(t.end)}`;
                      const real = tasks.findIndex((x) => x.member === t.member && x.kind === t.kind);
                      return (
                        <div
                          key={`${t.member}-${t.kind}-${t.role}-${t.lane}`}
                          role={touchUp ? undefined : "button"}
                          tabIndex={touchUp ? undefined : 0}
                          aria-label={touchUp ? undefined : `${label}, ${time}. Arrow keys move it.`}
                          title={`${label}, ${time}`}
                          data-task={touchUp ? undefined : `${t.member}-${t.kind}`}
                          onKeyDown={touchUp ? undefined : (e) => onKey(e, real)}
                          onPointerDown={
                            touchUp
                              ? undefined
                              : (e) => {
                                  if (e.button !== 0) return;
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                  setDrag({ index: real, x: e.clientX, y: e.clientY, from: tasks[real], start: tasks[real].start, lane: tasks[real].lane, moved: false });
                                }
                          }
                          onPointerMove={
                            touchUp
                              ? undefined
                              : (e) => {
                                  if (!drag) return;
                                  const dx = e.clientX - drag.x;
                                  if (!drag.moved && Math.abs(dx) < 4 && Math.abs(e.clientY - drag.y) < 4) return;
                                  let lane = drag.from.lane;
                                  for (const [k, el] of rows.current) {
                                    const r = el.getBoundingClientRect();
                                    if (k.startsWith(`${drag.from.role}-`) && e.clientY >= r.top && e.clientY <= r.bottom) lane = Number(k.split("-")[1]);
                                  }
                                  setDrag({ ...drag, start: Math.round((drag.from.start + dx * minutesPerPx()) / 5) * 5, lane, moved: true });
                                }
                          }
                          onPointerUp={
                            touchUp
                              ? undefined
                              : () => {
                                  if (drag?.moved) commit(moveTask(tasks, drag.index, { start: drag.start, lane: drag.lane }, lanes));
                                  setDrag(null);
                                }
                          }
                          onPointerCancel={() => setDrag(null)}
                          className={`absolute inset-y-1 touch-none overflow-hidden rounded border-l-4 px-1.5 text-xs leading-tight text-ink select-none focus-visible:outline-2 focus-visible:outline-focus ${
                            touchUp ? "border-line-strong bg-surface bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgb(23_39_59/0.1)_4px_8px)]" : `${ROLE_STYLE[t.role]} cursor-grab`
                          } ${drag?.moved && drag.from.member === t.member && drag.from.kind === t.kind ? "z-10 shadow-lift" : ""}`}
                          style={{ left: pct(t.start), width: `calc(${pct(t.end)} - ${pct(t.start)})` }}
                        >
                          {!touchUp && (
                            <>
                              <span className="block truncate pt-1 font-semibold">{nameOf(t.member!)}</span>
                              <span className="block truncate text-ink-muted tabular-nums">{time}</span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {liveProblems.length > 0 && (
        <p className="text-sm text-danger" role="status" data-testid="drag-problems">
          {liveProblems[0]}
        </p>
      )}
      <p className="text-xs text-ink-subtle">Drag a bar to change the time, or onto another artist doing the same work. Arrow keys move the one you&rsquo;ve tapped.</p>

      <ol className="flex flex-col divide-y divide-line text-sm" aria-label="Timeline" data-testid="timeline">
        {shown
          .filter((t) => t.kind !== "touch_up")
          .map((t) => (
            <li key={`${t.member}-${t.kind}`} className="flex items-baseline justify-between gap-2 py-1.5">
              <span className="tabular-nums text-ink-muted">
                {formatMinute(t.start)}–{formatMinute(t.end)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {nameOf(t.member!)} · {KIND_LABELS[t.kind]}
              </span>
              <span className="shrink-0 text-ink-muted">{staffOf(t) ?? `${KIND_LABELS[t.role]} ${t.lane}`}</span>
            </li>
          ))}
        {shown.some((t) => t.kind === "touch_up") && (
          <li className="flex items-baseline justify-between gap-2 py-1.5">
            <span className="tabular-nums text-ink-muted">
              {formatMinute(shown.find((t) => t.kind === "touch_up")!.start)}–{formatMinute(readyBy)}
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
