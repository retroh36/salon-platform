"use client";

import { useLayoutEffect, type RefObject } from "react";

// The gap kept between a popup and the window's edge.
export const SCREEN_MARGIN = 8;

// Keeps an open popup or menu inside the window: if it would run off the
// right or left edge, it slides back in (the CSS `translate`, which leaves
// the pop-in animation's transform alone); if it would run off the bottom,
// it's capped there and scrolls. Measured from its layout box rather than
// what's drawn, so the pop-in's scale doesn't throw it off, and again when
// the window changes size. For popups placed with `absolute` under their
// button; fixed ones placed by hand already work out their own room.
export function useKeepOnScreen(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const fit = () => {
      const parent = el.offsetParent as HTMLElement | null;
      const base = parent?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const left = base.left + (parent?.clientLeft ?? 0) + el.offsetLeft;
      const top = base.top + (parent?.clientTop ?? 0) + el.offsetTop;
      const width = document.documentElement.clientWidth;
      let dx = 0;
      if (left + el.offsetWidth > width - SCREEN_MARGIN) dx = width - SCREEN_MARGIN - (left + el.offsetWidth);
      if (left + dx < SCREEN_MARGIN) dx = SCREEN_MARGIN - left;
      el.style.translate = dx ? `${Math.round(dx)}px 0` : "";
      el.style.maxHeight = "";
      const room = window.innerHeight - SCREEN_MARGIN - top;
      if (el.offsetHeight > room) {
        el.style.maxHeight = `${Math.max(160, Math.floor(room))}px`;
        el.style.overflowY = "auto";
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [ref, open]);
}
