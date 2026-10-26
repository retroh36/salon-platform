"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buttonClass, IconButton } from "@/components/ui/button";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, startOfWeek, type LocalDate } from "@/lib/scheduling/time";

const WEEKDAY_LETTERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function monthOf(date: LocalDate) {
  return date.slice(0, 7); // "2026-10"
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

// Six weeks of dates covering the month, Monday first.
function monthGrid(month: string): LocalDate[] {
  const first = startOfWeek(`${month}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

// A button showing the date that opens a small month calendar. Arrow keys
// move between days, Page Up/Down between months, Enter picks, Escape
// closes.
export function DatePicker({
  value,
  today,
  onChange,
  label = "Choose a date",
}: {
  value: LocalDate;
  today: LocalDate;
  onChange: (date: LocalDate) => void;
  label?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(value);
  const [month, setMonth] = useState(monthOf(value));
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  function show() {
    setFocused(value);
    setMonth(monthOf(value));
    setOpen(true);
  }

  function pick(date: LocalDate) {
    setOpen(false);
    if (date !== value) onChange(date);
  }

  function moveFocus(date: LocalDate) {
    setFocused(date);
    setMonth(monthOf(date));
  }

  // Close on a click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Keep keyboard focus on the focused day.
  useEffect(() => {
    if (open) grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
  }, [open, focused, month]);

  function onKeyDown(e: React.KeyboardEvent) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in steps) {
      e.preventDefault();
      moveFocus(addDays(focused, steps[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const target = addMonths(monthOf(focused), e.key === "PageUp" ? -1 : 1);
      moveFocus(clampToMonth(target, focused.slice(8)));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-dialog` : undefined}
        aria-label={`${label}: ${formatLongDay(value)}`}
        onClick={() => (open ? setOpen(false) : show())}
        className={buttonClass("secondary", "md", "min-w-44 justify-start")}
      >
        <CalendarIcon className="size-4 text-navy-700" />
        {formatLongDay(value, false).replace(/^(\w{3})\w*,/, "$1,")}
      </button>

      {open && (
        <div
          id={`${id}-dialog`}
          role="dialog"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="absolute top-full left-0 z-50 mt-2 w-72 origin-top-left animate-pop-in rounded-lg border border-line bg-surface p-3 shadow-lift"
        >
          <div className="mb-2 flex items-center justify-between">
            <IconButton label="Previous month" size="sm" onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeftIcon className="size-4" />
            </IconButton>
            <span className="font-semibold text-ink" aria-live="polite">
              {monthLabel(month)}
            </span>
            <IconButton label="Next month" size="sm" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRightIcon className="size-4" />
            </IconButton>
          </div>
          <div ref={grid} role="grid" aria-label={monthLabel(month)} className="grid grid-cols-7 gap-0.5 text-center text-sm">
            <div role="row" className="contents">
              {WEEKDAY_LETTERS.map((d) => (
                <span key={d} role="columnheader" className="py-1 text-xs font-semibold text-ink-muted">
                  {d}
                </span>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, week) => (
              <div key={week} role="row" className="contents">
                {monthGrid(month)
                  .slice(week * 7, week * 7 + 7)
                  .map((d) => {
                    const inMonth = monthOf(d) === month;
                    const selected = d === value;
                    return (
                      <span key={d} role="gridcell">
                        <button
                          type="button"
                          data-date={d}
                          tabIndex={d === focused ? 0 : -1}
                          aria-label={formatLongDay(d)}
                          aria-pressed={selected}
                          aria-current={d === today ? "date" : undefined}
                          onClick={() => pick(d)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              pick(d);
                            }
                          }}
                          className={`size-9 rounded-md transition-[background-color,color,transform] duration-(--motion-fast) active:scale-90 focus-visible:outline-2 focus-visible:outline-focus ${
                            selected
                              ? "bg-navy-900 font-semibold text-white"
                              : d === today
                                ? "font-semibold text-navy-900 ring-1 ring-navy-200 hover:bg-navy-100"
                                : inMonth
                                  ? "text-ink hover:bg-sunken"
                                  : "text-ink-subtle hover:bg-sunken"
                          }`}
                        >
                          {Number(d.slice(8))}
                        </button>
                      </span>
                    );
                  })}
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-end border-t border-line pt-2">
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => pick(today)}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// The same day of the month in another month, or its last day.
function clampToMonth(month: string, day: string): LocalDate {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(day), last)).padStart(2, "0")}`;
}
