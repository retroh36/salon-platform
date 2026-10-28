"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SCREEN_MARGIN } from "./keep-on-screen";

// The gap between a popover and what it's anchored to.
const GAP = 6;

// Where sheets and popovers are drawn: straight into the page's main area
// (or the body), out of anything inside it that could clip them or, with a
// transform, hold their fixed position inside a smaller box.
export function portalRoot(): HTMLElement {
  return document.querySelector<HTMLElement>("main") ?? document.body;
}

// A small panel anchored to what opened it (a shift, a day), with no
// backdrop: the page stays in view and usable around it. Placed under its
// anchor (over it when there's more room above), kept inside the window,
// and following the anchor as the page or a grid scrolls. Escape or a
// click outside closes it; focus moves into it and goes back to the anchor
// after. Drawn at the top of the page (`portalRoot`), like Sheet, so
// nothing on the page can clip it.
export function Popover({ anchor, label, onClose, children, className = "w-80" }: { anchor: HTMLElement; label: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  // The latest onClose, for the listeners set up once.
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const height = window.innerHeight;
      el.style.maxHeight = "";
      const below = height - a.bottom - GAP - SCREEN_MARGIN;
      const above = a.top - GAP - SCREEN_MARGIN;
      const up = el.offsetHeight > below && above > below;
      const room = Math.max(160, Math.floor(up ? above : below));
      if (el.offsetHeight > room) el.style.maxHeight = `${room}px`;
      const left = Math.min(Math.max(SCREEN_MARGIN, a.left), width - SCREEN_MARGIN - el.offsetWidth);
      el.style.left = `${Math.round(Math.max(SCREEN_MARGIN, left))}px`;
      el.style.top = `${Math.round(up ? a.top - GAP - el.offsetHeight : a.bottom + GAP)}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea, button");
    (first ?? panel.current)?.focus();
    const outside = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) close.current();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      close.current();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={`fixed top-0 left-0 z-[60] flex max-w-[calc(100vw-1rem)] animate-pop-in flex-col overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-lift outline-none ${className}`}
    >
      {children}
    </div>,
    portalRoot(),
  );
}
