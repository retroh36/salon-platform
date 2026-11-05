"use client";

import { useEffect, useState } from "react";
import { CloseIcon } from "@/components/ui/icons";

// How long a calendar message stays before it goes by itself.
export const NOTICE_MS = 3000;

// A message at the top of the calendar (a refused move, a saved change):
// it goes by itself after NOTICE_MS, waiting while the pointer is over it
// or it has focus (then the full time again after), and ✕ closes it at
// once. A new message starts the time again.
export function CalendarNotice({ tone, text, onClose }: { tone: "danger" | "success"; text: string; onClose: () => void }) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(onClose, NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [held, text, onClose]);
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      data-testid="calendar-notice"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={`flex animate-fade-in items-start justify-between gap-4 rounded-md border px-3 py-2 text-sm ${
        tone === "danger" ? "border-danger/30 bg-danger-soft text-danger" : "border-status-confirmed-ink/25 bg-status-confirmed-bg text-status-confirmed-ink"
      }`}
    >
      <span>{text}</span>
      <button type="button" onClick={onClose} className="-m-1 shrink-0 rounded-sm p-1 focus-visible:outline-2 focus-visible:outline-focus" aria-label="Dismiss">
        <CloseIcon className="size-4" />
      </button>
    </div>
  );
}
