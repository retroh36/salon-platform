"use client";

import { useEffect, useRef } from "react";
import { CloseIcon } from "./icons";

// A modal panel over the page: centered on wide screens, from the bottom
// on narrow ones. Escape or a tap outside closes it (and Escape goes no
// further, so it never also leaves the page). Focus moves into it.
export function Sheet({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    (first ?? panel.current)?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div
      className="fixed inset-0 z-[70] flex animate-fade-in items-end justify-center bg-navy-900/30 sm:items-center sm:p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            onClose();
          }
        }}
        className={`flex max-h-[92vh] w-full animate-pop-in flex-col overflow-hidden rounded-t-2xl bg-surface shadow-lift outline-none sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="font-serif text-xl font-semibold text-navy-900">{title}</h2>
          <button
            type="button"
            data-close
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors duration-(--motion-fast) hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
