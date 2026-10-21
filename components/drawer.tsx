"use client";

import { useEffect, useId, useRef } from "react";

// A panel over the right side of the page. Escape or the close button
// closes it; focus moves into it when it opens.
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  // The latest onClose, so the effect below runs once rather than on every
  // render (which would pull focus back to the panel).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={id}
      tabIndex={-1}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-neutral-200 bg-white shadow-xl focus:outline-none"
    >
      <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-xl leading-none text-neutral-500 hover:bg-neutral-100">
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </div>
  );
}
