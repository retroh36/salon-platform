"use client";

import { useEffect, useRef } from "react";

const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

// On the shared front-desk iPad: after the salon's idle time with no taps
// or keys, sign out to the PIN screen (/switch/lock), so the next person
// can't carry on as whoever was here.
export function AutoLock({ minutes }: { minutes: number }) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let timer = 0;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => form.current?.requestSubmit(), minutes * 60_000);
    };
    reset();
    for (const e of EVENTS) window.addEventListener(e, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const e of EVENTS) window.removeEventListener(e, reset);
    };
  }, [minutes]);
  return <form ref={form} action="/switch/lock?idle=1" method="post" hidden data-testid="auto-lock" data-minutes={minutes} />;
}
