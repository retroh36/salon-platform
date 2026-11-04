"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Shows the first of `variants` (longest first) that fits in the space
// available, so text shortens rather than being cut off. Refits when the
// space changes. With `lines={2}`, a variant that fits on one line still
// wins over a longer one wrapped (so "Kids' Cut" beats "Kids' Cut (12 &" /
// "under)"), and a wrapped variant counts only when no word is broken
// across lines. The last variant is clipped with an ellipsis, on one line,
// only if even that doesn't fit.
export function FitText({ variants, lines = 1, className = "" }: { variants: string[]; lines?: 1 | 2; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<{ index: number; lines: 1 | 2 }>({ index: 0, lines });
  const key = variants.join("\u0000");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const refit = () => {
      setFit(choose(el, variants, lines));
    };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(el);
    // Measured again once the web font is in: before it, a line can fit in
    // the fallback font and then not in Geist.
    let live = true;
    document.fonts?.ready.then(() => live && refit());
    return () => {
      live = false;
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `variants`
  }, [key, lines]);

  return (
    <span ref={ref} className={`block min-w-0 ${fit.lines === 2 ? "line-clamp-2" : "truncate"} ${className}`}>
      {variants[Math.min(fit.index, variants.length - 1)]}
    </span>
  );
}

// Measures each variant in place, longest first: on one line first, then
// (with two lines allowed) wrapped.
function choose(el: HTMLElement, variants: string[], lines: 1 | 2): { index: number; lines: 1 | 2 } {
  const passes: (1 | 2)[] = lines === 2 ? [1, 2] : [1];
  for (const pass of passes) {
    el.classList.toggle("truncate", pass === 1);
    el.classList.toggle("line-clamp-2", pass === 2);
    for (let i = 0; i < variants.length; i++) {
      el.textContent = variants[i];
      if (fits(el)) return { index: i, lines: pass };
    }
  }
  el.classList.toggle("truncate", true);
  el.classList.toggle("line-clamp-2", false);
  return { index: variants.length - 1, lines: 1 };
}

// Whether the text fits its box. scrollWidth is rounded to whole pixels, so a
// line a fraction of a pixel too long passes it and still shows "…": one
// line is measured exactly. Wrapped, a word too long for the line overflows
// sideways (words aren't broken), which counts as not fitting.
function fits(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight + 0.5) return false;
  const text = document.createRange();
  text.selectNodeContents(el);
  return text.getBoundingClientRect().width <= el.getBoundingClientRect().width + 0.01;
}
