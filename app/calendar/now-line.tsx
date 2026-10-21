"use client";

import { useSyncExternalStore } from "react";
import { formatMinute, toLocal, type LocalDate } from "@/lib/scheduling/time";

// The current time, ticking every 30 seconds. Null on the server (and while
// hydrating), so anything that depends on "now" appears once the page is
// running in the browser.
function subscribe(onTick: () => void) {
  const timer = setInterval(onTick, 30_000);
  return () => clearInterval(timer);
}
const getNow = () => Math.floor(Date.now() / 30_000) * 30_000;
const getServerNow = () => null;

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getNow, getServerNow);
}

// A line across the columns at the current time, with the time in a pill
// over the time axis, when the day shown is today at the salon and now is
// within the hours drawn.
export function NowLine({
  date,
  timeZone,
  startMinute,
  endMinute,
  pxPerMinute,
}: {
  date: LocalDate;
  timeZone: string;
  startMinute: number;
  endMinute: number;
  pxPerMinute: number;
}) {
  const now = useNow();
  if (now === null) return null;

  const local = toLocal(new Date(now), timeZone);
  if (local.date !== date || local.minute < startMinute || local.minute >= endMinute) return null;

  return (
    <div
      role="img"
      aria-label={`Now, ${formatMinute(local.minute)}`}
      className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-now"
      style={{ top: (local.minute - startMinute) * pxPerMinute }}
    >
      <span className="absolute -top-2.5 -left-[3.75rem] w-14 rounded-full bg-now py-0.5 text-center text-[11px] leading-4 font-semibold text-white">
        {formatMinute(local.minute)}
      </span>
      <span className="absolute -top-[5px] -left-1 size-2 rounded-full bg-now" />
    </div>
  );
}
