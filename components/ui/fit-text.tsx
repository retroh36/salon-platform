"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Shows the first of `variants` (longest first) that fits in the space
// available (one line, or `lines` lines), so text shortens rather than
// being cut off. Refits when the space changes. The last variant is
// clipped with an ellipsis only if even that doesn't fit.
export function FitText({ variants, lines = 1, className = "" }: { variants: string[]; lines?: 1 | 2; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [index, setIndex] = useState(0);
  const key = variants.join("\u0000");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      // Measure each variant in place, longest first.
      for (let i = 0; i < variants.length; i++) {
        el.textContent = variants[i];
        if (el.scrollWidth <= el.clientWidth + 0.5 && el.scrollHeight <= el.clientHeight + 0.5) {
          setIndex(i);
          return;
        }
      }
      setIndex(variants.length - 1);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `variants`
  }, [key, lines]);

  return (
    <span ref={ref} className={`block min-w-0 ${lines === 2 ? "line-clamp-2 break-words" : "truncate"} ${className}`}>
      {variants[Math.min(index, variants.length - 1)]}
    </span>
  );
}
