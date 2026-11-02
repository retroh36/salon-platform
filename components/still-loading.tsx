"use client";

// Under "Loading Maestra…": if the page hasn't come after 10 seconds (a
// connection that stalled mid-load), says so with Reload; at 20 seconds it
// reloads by itself, once per page and tab, so a stuck load recovers the
// way a fresh tab would, but only when nothing would be lost
// (`hasUnsavedWork`): otherwise Reload stays for them to choose.

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { hasUnsavedWork } from "@/lib/unsaved-work";

export const SLOW_LOAD_MS = 10_000;
export const RELOAD_LOAD_MS = 20_000;
const KEY = "maestra:reloaded:";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

// The timers, apart from React (tests/unit/still-loading.test.ts). Returns
// what to do once the page has loaded: forget the reload, so a later stall
// on this page may reload again.
export function watchLoading(
  page: string,
  storage: Storage | null,
  on: { slow: () => void; reload: () => void; unsaved?: () => boolean },
): { stop: () => void; loaded: () => void } {
  const key = KEY + page;
  const timers = [
    setTimeout(on.slow, SLOW_LOAD_MS),
    setTimeout(() => {
      if (on.unsaved?.()) return;
      try {
        if (!storage || storage.getItem(key)) return;
        storage.setItem(key, "1");
      } catch {
        return;
      }
      on.reload();
    }, RELOAD_LOAD_MS),
  ];
  return {
    stop: () => timers.forEach(clearTimeout),
    loaded: () => {
      try {
        storage?.removeItem(key);
      } catch {
        // Storage blocked: nothing to tidy.
      }
    },
  };
}

export function StillLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = sessionStorage;
    } catch {
      storage = null;
    }
    const watch = watchLoading(location.pathname + location.search, storage, { slow: () => setSlow(true), reload: () => location.reload(), unsaved: hasUnsavedWork });
    // Unmounted: the page came (or the person moved on).
    return () => {
      watch.stop();
      watch.loaded();
    };
  }, []);
  if (!slow) return null;
  return (
    <span className="flex flex-col items-center gap-3" data-testid="still-loading">
      This is taking longer than usual.
      <button type="button" className={buttonClass("secondary")} onClick={() => location.reload()}>
        Reload
      </button>
    </span>
  );
}
