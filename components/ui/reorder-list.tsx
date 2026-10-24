"use client";

import { useRef, useState } from "react";
import { moveItem } from "@/lib/calendar-views";
import { IconButton } from "./button";
import { ChevronDownIcon, ChevronUpIcon, GripIcon } from "./icons";

export type ReorderItem = { id: string; label: string; detail?: string; leading?: React.ReactNode; trailing?: React.ReactNode };

// A list you put in order: drag a row by its grip (mouse, finger or pen),
// or use its up and down buttons (keyboard and screen readers). Each move
// calls onChange with the ids in their new order.
export function ReorderList({ items, onChange, label }: { items: ReorderItem[]; onChange: (ids: string[]) => void; label: string }) {
  const rows = useRef(new Map<string, HTMLLIElement>());
  // The row being dragged, and where it would go.
  const [drag, setDrag] = useState<{ id: string; pointerId: number; to: number } | null>(null);
  const ids = items.map((i) => i.id);
  const shown = drag ? moveItem(items, ids.indexOf(drag.id), drag.to) : items;

  // Where the dragged row would go: after every other row whose middle
  // the pointer is below.
  const placeAt = (dragged: string, clientY: number) => {
    let to = 0;
    for (const id of ids) {
      const r = id === dragged ? null : rows.current.get(id)?.getBoundingClientRect();
      if (r && clientY > r.top + r.height / 2) to++;
    }
    return to;
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    onChange(moveItem(ids, from, to));
  };

  return (
    <ol aria-label={label} className="flex flex-col gap-1.5">
      {shown.map((item, i) => {
        const dragging = drag?.id === item.id;
        return (
          <li
            key={item.id}
            ref={(el) => {
              if (el) rows.current.set(item.id, el);
              else rows.current.delete(item.id);
            }}
            data-reorder-row={item.id}
            className={`flex min-h-12 items-center gap-2 rounded-lg border bg-surface py-1 pr-1 pl-1.5 transition-shadow duration-(--motion-fast) ${dragging ? "z-10 border-navy-700 shadow-lift" : "border-line"}`}
          >
            <span
              aria-hidden
              title="Drag to reorder"
              className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-ink-subtle hover:bg-sunken active:cursor-grabbing"
              onPointerDown={(e) => {
                if (e.button !== 0 || drag) return;
                e.preventDefault();
                // Followed on the window: the row moves in the page as it's
                // dragged, which would lose a pointer capture.
                const pointerId = e.pointerId;
                const from = ids.indexOf(item.id);
                let to = from;
                setDrag({ id: item.id, pointerId, to });
                const onMove = (ev: PointerEvent) => {
                  if (ev.pointerId !== pointerId) return;
                  to = placeAt(item.id, ev.clientY);
                  setDrag({ id: item.id, pointerId, to });
                };
                const onEnd = (ev: PointerEvent) => {
                  if (ev.pointerId !== pointerId) return;
                  window.removeEventListener("pointermove", onMove);
                  window.removeEventListener("pointerup", onEnd);
                  window.removeEventListener("pointercancel", onEnd);
                  setDrag(null);
                  if (ev.type === "pointerup") move(from, to);
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onEnd);
                window.addEventListener("pointercancel", onEnd);
              }}
            >
              <GripIcon className="size-4" />
            </span>
            {item.leading}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{item.label}</span>
              {item.detail && <span className="block truncate text-xs text-ink-muted">{item.detail}</span>}
            </span>
            {item.trailing}
            <IconButton label={`Move ${item.label} up`} size="sm" disabled={i === 0 || !!drag} onClick={() => move(i, i - 1)}>
              <ChevronUpIcon className="size-4" />
            </IconButton>
            <IconButton label={`Move ${item.label} down`} size="sm" disabled={i === items.length - 1 || !!drag} onClick={() => move(i, i + 1)}>
              <ChevronDownIcon className="size-4" />
            </IconButton>
          </li>
        );
      })}
    </ol>
  );
}
