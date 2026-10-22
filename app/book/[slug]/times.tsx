"use client";

import { useEffect, useRef } from "react";
import { formatMinute, type LocalDate } from "@/lib/scheduling/time";
import type { DayTimes } from "./actions";

const asDate = (date: LocalDate) => new Date(`${date}T12:00:00Z`);

// "Tuesday, November 3", or "Tue, Nov 3" when short.
export function longDate(date: LocalDate, short = false): string {
  return asDate(date).toLocaleDateString("en-US", short ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" } : { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

// Two weeks of days to choose from; days with no times are dimmed.
export function DateStrip({
  days,
  selected,
  onSelect,
  onMore,
  loading,
}: {
  days: DayTimes[];
  selected: LocalDate | null;
  onSelect: (date: LocalDate) => void;
  onMore: (() => void) | null;
  loading: boolean;
}) {
  // Keep the chosen day in view.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>("[aria-checked=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);
  return (
    <div ref={strip} role="radiogroup" aria-label="Date" className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {days.map((d) => {
        const on = d.date === selected;
        const empty = d.times.length === 0;
        return (
          <button
            key={d.date}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${longDate(d.date)}${empty ? ", no times" : `, ${d.times.length} times`}`}
            onClick={() => onSelect(d.date)}
            className={`flex min-h-18 w-15 shrink-0 snap-start flex-col items-center justify-center rounded-xl border text-center transition-colors duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
              on ? "border-(--accent) bg-(--accent) text-white" : empty ? "border-line bg-sunken text-ink-subtle" : "border-line bg-surface text-ink hover:border-(--accent-line)"
            }`}
          >
            <span className="text-xs font-medium uppercase">{asDate(d.date).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</span>
            <span className="font-serif text-xl font-semibold">{asDate(d.date).getUTCDate()}</span>
            <span className="text-[11px]">{asDate(d.date).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span>
          </button>
        );
      })}
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          disabled={loading}
          className="flex min-h-18 w-24 shrink-0 items-center justify-center rounded-xl border border-dashed border-line-strong px-2 text-sm font-semibold text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          {loading ? "Loading…" : "Later dates"}
        </button>
      )}
    </div>
  );
}

const PARTS: [string, number, number][] = [
  ["Morning", 0, 12 * 60],
  ["Afternoon", 12 * 60, 17 * 60],
  ["Evening", 17 * 60, 24 * 60],
];

export function TimeGrid<T extends { minute: number }>({
  times,
  selected,
  onPick,
  label,
}: {
  times: T[];
  selected: number | null;
  onPick: (t: T) => void;
  label?: (t: T) => string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {PARTS.map(([name, from, to]) => {
        const part = times.filter((t) => t.minute >= from && t.minute < to);
        if (!part.length) return null;
        return (
          <div key={name} role="radiogroup" aria-label={name}>
            <p className="mb-2 text-xs font-semibold tracking-wider text-ink-muted uppercase">{name}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {part.map((t) => {
                const on = t.minute === selected;
                return (
                  <button
                    key={t.minute}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => onPick(t)}
                    className={`flex min-h-12 flex-col items-center justify-center rounded-xl border px-1 text-base font-semibold tabular-nums transition-colors duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                      on ? "border-(--accent) bg-(--accent) text-white" : "border-line bg-surface text-ink hover:border-(--accent-line)"
                    }`}
                  >
                    {formatMinute(t.minute)}
                    {label && <span className={`max-w-full truncate text-[11px] font-medium ${on ? "text-white/90" : "text-ink-muted"}`}>{label(t)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
