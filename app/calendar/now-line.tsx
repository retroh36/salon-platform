"use client";

import { useSyncExternalStore } from "react";
import { formatMinute, toLocal, type LocalDate } from "@/lib/scheduling/time";

// Ticks every 30 seconds. On the server (and while hydrating) there's no
// "now", so the line appears once the page is running in the browser.
function subscribe(onTick: () => void) {
  const timer = setInterval(onTick, 30_000);
  return () => clearInterval(timer);
}
const getNow = () => Math.floor(Date.now() / 30_000) * 30_000;
const getServerNow = () => null;

// A line across the columns at the current time, when the day shown is
// today at the salon and now is within the hours drawn.
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
  const now = useSyncExternalStore(subscribe, getNow, getServerNow);
  if (now === null) return null;

  const local = toLocal(new Date(now), timeZone);
  if (local.date !== date || local.minute < startMinute || local.minute >= endMinute) return null;

  return (
    <div
      role="img"
      aria-label={`Now, ${formatMinute(local.minute)}`}
      className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
      style={{ top: (local.minute - startMinute) * pxPerMinute }}
    >
      <span className="absolute -top-1.5 -left-1.5 size-3 rounded-full bg-red-500" />
    </div>
  );
}
