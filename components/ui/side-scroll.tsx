"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { buttonClass } from "./button";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

// Rows and boards wider than their room scroll sideways, and since
// scrollbars stay out of sight, the side with more says so: a fade at that
// edge and an arrow button that scrolls about a screen's worth that way.
// Nothing shows on a side with nothing more, so the first item is never
// faded as if it were cut off.
// - `SideScroll`: a row of items (the checkout's quick-add tiles), faded
//   with a mask.
// - `SideScrollEdges`: over a scroller of your own (the calendar's grid,
//   the team's week), with the fades drawn on top, starting after a sticky
//   column (`leftInset`) so that column never fades.

// A few pixels' slack: Safari can rest a swipe a pixel or two off the start.
export const MORE_SLACK = 8;

export type More = { left: boolean; right: boolean };

export function sideMore(el: { scrollLeft: number; clientWidth: number; scrollWidth: number }): More {
  return { left: el.scrollLeft > MORE_SLACK, right: el.scrollLeft + el.clientWidth < el.scrollWidth - MORE_SLACK };
}

export function useSideMore(ref: RefObject<HTMLElement | null>): More {
  const [more, setMore] = useState<More>({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setMore((was) => {
        const now = sideMore(el);
        return now.left === was.left && now.right === was.right ? was : now;
      });
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Its own size, and what's inside it (columns coming and going).
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    for (const child of el.children) seen.observe(child);
    const added = new MutationObserver(() => {
      for (const child of el.children) seen.observe(child);
      measure();
    });
    added.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", measure);
      seen.disconnect();
      added.disconnect();
    };
  }, [ref]);
  return more;
}

function useScrollBy(ref: RefObject<HTMLElement | null>, inset: () => number) {
  return useCallback(
    (direction: 1 | -1) => {
      const el = ref.current;
      if (!el) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollBy({ left: direction * Math.max(80, (el.clientWidth - inset()) * 0.8), behavior: still ? "auto" : "smooth" });
    },
    [ref, inset],
  );
}

function Arrow({ side, label, onClick, className = "" }: { side: "left" | "right"; label: string; onClick: () => void; className?: string }) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      // The scroller itself scrolls by keyboard; these are for a pointer.
      tabIndex={-1}
      aria-label={`${label} to the ${side}`}
      title={`${label} to the ${side}`}
      onClick={onClick}
      data-side-arrow={side}
      className={buttonClass("secondary", "sm", `pointer-events-auto animate-fade-in shadow-lift ${className}`, { square: true })}
    >
      <Icon className="size-4" />
    </button>
  );
}

// A row of items that scrolls sideways.
export function SideScroll({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const more = useSideMore(ref);
  const by = useScrollBy(ref, useCallback(() => 0, []));
  const fade = `linear-gradient(to right, ${more.left ? "transparent, black 3rem" : "black"}, ${more.right ? "black calc(100% - 3rem), transparent" : "black"})`;
  return (
    <div className="relative">
      <div
        ref={ref}
        data-more-left={more.left || undefined}
        data-more-right={more.right || undefined}
        style={{ maskImage: fade, WebkitMaskImage: fade }}
        className={`flex overflow-x-auto overscroll-x-contain ${className}`}
      >
        {children}
      </div>
      {more.left && <Arrow side="left" label={label} onClick={() => by(-1)} className="absolute top-1/2 left-2 z-[46] -translate-y-1/2" />}
      {more.right && <Arrow side="right" label={label} onClick={() => by(1)} className="absolute top-1/2 right-2 z-[46] -translate-y-1/2" />}
    </div>
  );
}

// The fades and arrows over a scroller of your own; its parent is
// `relative` and the same size as the scroller. Each arrow rides down its
// edge with the page (sticky, near the middle of the screen), so a table
// or a week taller than the screen still shows it. `rightInset`: something
// floats over the scroller's right side (Denise's card on the calendar), so
// the right fade and arrow sit just left of it.
export function SideScrollEdges({
  target,
  label,
  leftInset = "0px",
  rightInset = "0px",
}: {
  target: RefObject<HTMLElement | null>;
  label: string;
  leftInset?: string;
  rightInset?: string;
}) {
  const more = useSideMore(target);
  const inset = useRef<HTMLDivElement>(null);
  const by = useScrollBy(
    target,
    useCallback(() => inset.current?.offsetWidth ?? 0, []),
  );
  const edge = "pointer-events-none absolute inset-y-px z-[46] flex w-12 justify-center py-2";
  const arrow = "sticky top-[45vh] self-start";
  return (
    <>
      {/* Measures the sticky column, so a page's scroll never hides under it. */}
      <div ref={inset} aria-hidden className="pointer-events-none invisible absolute h-0" style={{ width: leftInset }} />
      {more.left && (
        <div data-more-left className={`${edge} bg-linear-to-r from-surface to-transparent`} style={{ left: `calc(${leftInset} + 1px)` }}>
          <Arrow side="left" label={label} onClick={() => by(-1)} className={arrow} />
        </div>
      )}
      {more.right && (
        <div data-more-right className={`${edge} bg-linear-to-l from-surface to-transparent`} style={{ right: `calc(${rightInset} + 1px)` }}>
          <Arrow side="right" label={label} onClick={() => by(1)} className={arrow} />
        </div>
      )}
    </>
  );
}
