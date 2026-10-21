"use client";

import { startTransition, useOptimistic, useRef, useState } from "react";
import { isEditable } from "@/lib/appointments";
import { hourMarks, layoutColumn } from "@/lib/calendar";
import { formatMinute } from "@/lib/scheduling/time";
import { moveVisitItem } from "./actions";
import { AppointmentPanel } from "./appointment-panel";
import { BookingPanel, type BookingStart } from "./booking-panel";
import { NowLine } from "./now-line";
import type { BlockData, BoardData, ColumnData } from "./types";

export const PX_PER_MINUTE = 1.6;
// Moves snap to 5 minutes; a click on an empty slot to the quarter hour.
const MOVE_STEP = 5;
const SLOT_STEP = 15;
// Pointer travel before a press counts as a drag rather than a click.
const DRAG_THRESHOLD = 5;

type Panel = { kind: "book"; start: BookingStart } | { kind: "edit"; appointmentId: string } | { kind: "detail"; appointmentId: string } | null;

type Move = { itemId: string; staffId: string; start: number };

type Drag = Move & {
  pointerId: number;
  x: number;
  y: number;
  fromStaffId: string;
  fromStart: number;
  length: number;
  moved: boolean;
};

export function CalendarBoard({ data }: { data: BoardData }) {
  const { range, columns, me } = data;
  const height = (range.end - range.start) * PX_PER_MINUTE;
  const y = (minute: number) => (minute - range.start) * PX_PER_MINUTE;

  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // A drag ends with a click on the block; this stops it opening the panel.
  const justDragged = useRef(false);
  const columnRefs = useRef(new Map<string, HTMLElement>());

  // Moves show straight away and snap back if the server refuses them.
  const [moves, addMove] = useOptimistic<Record<string, Move>, Move>({}, (all, m) => ({ ...all, [m.itemId]: m }));

  // While dragging, the block stays put (it holds the pointer) and a ghost
  // shows where it would go.
  const placed = (b: BlockData): BlockData => {
    const m = moves[b.itemId];
    if (!m) return b;
    const shift = m.start - b.start;
    return { ...b, staffId: m.staffId, start: b.start + shift, end: b.end + shift, segments: b.segments.map((s) => ({ ...s, start: s.start + shift, end: s.end + shift })) };
  };
  const blocks = data.blocks.map(placed);

  const canMove = (b: BlockData) => me.canBook && isEditable(b.status);

  function columnAt(clientX: number): string | null {
    for (const [staffId, el] of columnRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return staffId;
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent, b: BlockData) {
    if (e.button !== 0 || !canMove(b)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      itemId: b.itemId,
      staffId: b.staffId,
      start: b.start,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      fromStaffId: b.staffId,
      fromStart: b.start,
      length: b.end - b.start,
      moved: false,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    const shift = Math.round(dy / PX_PER_MINUTE / MOVE_STEP) * MOVE_STEP;
    const start = Math.min(Math.max(d.fromStart + shift, range.start), range.end - d.length);
    const next = { ...d, moved: true, start, staffId: columnAt(e.clientX) ?? d.staffId };
    dragRef.current = next;
    setDrag(next);
  }

  function onPointerUp(e: React.PointerEvent, b: BlockData) {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || e.pointerId !== d.pointerId || !d.moved) return;
    justDragged.current = true;
    if (d.staffId === d.fromStaffId && d.start === d.fromStart) return;
    const move = { itemId: d.itemId, staffId: d.staffId, start: d.start };
    setNotice(null);
    startTransition(async () => {
      addMove(move);
      const result = await moveVisitItem({ itemId: move.itemId, staffId: move.staffId, date: data.date, startMinute: move.start });
      if (!result.ok) setNotice(`Couldn't move ${b.clientName}'s ${b.service}: ${result.message}`);
    });
  }

  function onSlotClick(e: React.MouseEvent<HTMLElement>, column: ColumnData) {
    if (!me.canBook || (e.target as HTMLElement).closest("[data-block]")) return;
    const top = e.currentTarget.getBoundingClientRect().top;
    const minute = range.start + Math.floor((e.clientY - top) / PX_PER_MINUTE / SLOT_STEP) * SLOT_STEP;
    setPanel({ kind: "book", start: { staffId: column.staffId, startMinute: Math.min(minute, range.end - SLOT_STEP) } });
  }

  const gridColumns = { gridTemplateColumns: `4rem repeat(${columns.length}, minmax(10rem, 1fr))` };
  const close = () => setPanel(null);

  return (
    <>
      {me.canBook && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setPanel({ kind: "book", start: { staffId: columns[0].staffId, startMinute: range.start } })}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            New appointment
          </button>
          <span className="text-sm text-neutral-500">Click an empty time to book it, or drag an appointment to move it.</span>
        </div>
      )}

      {notice && (
        <div role="alert" className="mb-3 flex items-start justify-between gap-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-medium" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <div className="min-w-max">
          <div className="grid border-b border-neutral-200" style={gridColumns}>
            <div />
            {columns.map((c) => (
              <div key={c.staffId} className="border-l border-neutral-200 px-3 py-2">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-neutral-500">{c.hoursLabel}</div>
              </div>
            ))}
          </div>

          <div className="relative grid" style={gridColumns} data-range-start={range.start}>
            <div className="relative" style={{ height }} aria-hidden>
              {hourMarks(range).map((m) => (
                <span
                  key={m}
                  className={`absolute right-2 text-xs text-neutral-500 ${m === range.start ? "translate-y-1" : "-translate-y-1/2"}`}
                  style={{ top: y(m) }}
                >
                  {formatMinute(m)}
                </span>
              ))}
            </div>

            {columns.map((c) => (
              <section
                key={c.staffId}
                ref={(el) => {
                  if (el) columnRefs.current.set(c.staffId, el);
                  else columnRefs.current.delete(c.staffId);
                }}
                aria-label={c.name}
                data-staff-id={c.staffId}
                onClick={(e) => onSlotClick(e, c)}
                className={`relative border-l border-neutral-200 ${me.canBook ? "cursor-cell" : ""} ${drag?.moved && drag.staffId === c.staffId ? "bg-blue-50/40" : ""}`}
                style={{
                  height,
                  backgroundImage: `linear-gradient(to bottom, #e5e5e5 1px, transparent 1px), linear-gradient(to bottom, #f5f5f5 1px, transparent 1px)`,
                  backgroundSize: `100% ${60 * PX_PER_MINUTE}px, 100% ${30 * PX_PER_MINUTE}px`,
                }}
              >
                {c.offHours.map((o) => (
                  <div
                    key={o.start}
                    data-off-hours
                    aria-hidden
                    title="Not bookable"
                    className="absolute inset-x-0 bg-neutral-100/80"
                    style={{
                      top: y(o.start),
                      height: (o.end - o.start) * PX_PER_MINUTE,
                      backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, rgb(0 0 0 / 0.04) 6px 12px)",
                    }}
                  />
                ))}

                {c.timeOff.map((t) => (
                  <div
                    key={`${t.start}-${t.label}`}
                    data-time-off
                    className="absolute inset-x-0 z-0 border-y border-neutral-300 bg-neutral-200/90 px-2 py-1 text-xs font-medium text-neutral-600"
                    style={{ top: y(t.start), height: (t.end - t.start) * PX_PER_MINUTE }}
                  >
                    Time off: {t.label}
                    <span className="sr-only"> for {c.name}</span>
                  </div>
                ))}

                {drag?.moved && drag.staffId === c.staffId && (
                  <div
                    data-drag-ghost
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0.5 z-40 rounded-md border-2 border-dashed border-blue-500 bg-blue-100/60 px-1.5 text-xs font-medium text-blue-900"
                    style={{ top: y(drag.start), height: drag.length * PX_PER_MINUTE }}
                  >
                    {formatMinute(drag.start)}
                  </div>
                )}

                <ul aria-label={`${c.name}'s appointments`}>
                  {layoutColumn(blocks.filter((b) => b.staffId === c.staffId)).map((b) => (
                    <AppointmentBlock
                      key={b.itemId}
                      block={b}
                      color={data.colors[b.category] ?? "#525252"}
                      y={y}
                      draggable={canMove(b)}
                      dragging={drag?.moved === true && drag.itemId === b.itemId}
                      onPointerDown={(e) => onPointerDown(e, b)}
                      onPointerMove={onPointerMove}
                      onPointerUp={(e) => onPointerUp(e, b)}
                      onPointerCancel={() => {
                        dragRef.current = null;
                        setDrag(null);
                      }}
                      onOpen={() => {
                        if (justDragged.current) justDragged.current = false;
                        else setPanel({ kind: "detail", appointmentId: b.appointmentId });
                      }}
                    />
                  ))}
                </ul>
              </section>
            ))}

            <div className="pointer-events-none absolute inset-y-0 right-0 left-16">
              <NowLine date={data.date} timeZone={data.timeZone} startMinute={range.start} endMinute={range.end} pxPerMinute={PX_PER_MINUTE} />
            </div>
          </div>
        </div>
      </div>

      {panel?.kind === "detail" && data.appointments[panel.appointmentId] && (
        <AppointmentPanel
          key={panel.appointmentId}
          date={data.date}
          appointment={data.appointments[panel.appointmentId]}
          me={me}
          onEdit={() => setPanel({ kind: "edit", appointmentId: panel.appointmentId })}
          onClose={close}
        />
      )}
      {panel?.kind === "book" && <BookingPanel data={data} start={panel.start} onClose={close} onSaved={close} />}
      {panel?.kind === "edit" && data.appointments[panel.appointmentId] && (
        <BookingPanel
          key={panel.appointmentId}
          data={data}
          appointment={data.appointments[panel.appointmentId]}
          onClose={() => setPanel({ kind: "detail", appointmentId: panel.appointmentId })}
          onSaved={() => setPanel({ kind: "detail", appointmentId: panel.appointmentId })}
        />
      )}
    </>
  );
}

const STATUS_NOTES: Partial<Record<string, string>> = { checked_in: "Checked in", completed: "Checked out", no_show: "No-show" };

function AppointmentBlock({
  block,
  color,
  y,
  draggable,
  dragging,
  onOpen,
  ...pointer
}: {
  block: BlockData & { depth: number };
  color: string;
  y: (minute: number) => number;
  draggable: boolean;
  dragging: boolean;
  onOpen: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}) {
  const time = `${formatMinute(block.start)}–${formatMinute(block.end)}`;
  const processing = block.segments.find((s) => s.kind === "processing");
  const note = STATUS_NOTES[block.status];
  const height = (block.end - block.start) * PX_PER_MINUTE;

  const label = [
    time,
    block.clientName,
    block.service,
    processing && `processing ${formatMinute(processing.start)}–${formatMinute(processing.end)}`,
    block.with.length > 0 && `with ${block.with.join(" and ")}`,
    block.resource,
    note,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li className="contents">
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        title={label}
        data-block
        data-category={block.category}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        {...pointer}
        className={`absolute block touch-none overflow-hidden rounded-md border-l-4 bg-white text-left text-neutral-900 shadow-sm ring-1 ring-white select-none hover:ring-2 hover:ring-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-none ${
          block.status === "no_show" ? "opacity-50" : ""
        } ${draggable ? "cursor-grab" : "cursor-pointer"} ${dragging ? "cursor-grabbing opacity-40" : ""}`}
        style={{
          top: y(block.start),
          height,
          left: `calc(${Math.min(block.depth, 3) * 30}% + 2px)`,
          right: 2,
          zIndex: 10 + block.depth,
          borderLeftColor: color,
        }}
      >
        {block.segments.map((s) => (
          <span
            key={s.kind}
            aria-hidden
            data-segment={s.kind}
            className="absolute inset-x-0"
            style={{
              top: (s.start - block.start) * PX_PER_MINUTE,
              height: (s.end - s.start) * PX_PER_MINUTE,
              ...(s.kind === "processing"
                ? { backgroundColor: `${color}0d`, backgroundImage: `repeating-linear-gradient(135deg, transparent 0 6px, ${color}26 6px 12px)` }
                : { backgroundColor: `${color}40` }),
            }}
          />
        ))}
        <span aria-hidden className="relative block truncate px-1.5 pt-0.5 text-xs leading-4">
          <span className="font-medium">{block.clientName}</span> {formatMinute(block.start)}
        </span>
        {height >= 36 && (
          <span aria-hidden className="relative block truncate px-1.5 text-xs leading-4 text-neutral-700">
            {block.service}
            {block.with.length > 0 && ` · with ${block.with.join(", ")}`}
          </span>
        )}
        {note && height >= 52 && (
          <span aria-hidden className="relative block truncate px-1.5 text-xs leading-4 font-medium">
            {note}
          </span>
        )}
      </div>
    </li>
  );
}
