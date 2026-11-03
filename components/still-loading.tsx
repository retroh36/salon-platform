"use client";

// Under "Loading Maestra…": if the page hasn't come after 10 seconds (a
// connection that stalled mid-load), says so with Reload; at 20 seconds it
// reloads by itself, once per page and tab, so a stuck load recovers the
// way a fresh tab would, but only when nothing would be lost
// (`hasUnsavedWork`): otherwise Reload stays for them to choose.

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { errorRef } from "@/lib/app-errors";
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

// What a stalled load was waiting on, for the log (no data, only how the
// page was reached and what had arrived): `nav` is how the document came
// (navigate, reload, back_forward), `soft` a click inside the app after it,
// `doc` whether the HTML finished arriving and how big it was, `data`
// whether the server's data for this page came back (a soft load's _rsc
// request), then the connection and the tab.
export type LoadFacts = {
  nav: string;
  soft: boolean;
  docDone: boolean;
  docBytes: number;
  dataBack: boolean;
  online: boolean;
  visible: boolean;
  waitedMs: number;
};

export function loadFactsText(f: LoadFacts): string {
  return [
    `nav=${f.nav}`,
    `soft=${f.soft ? "yes" : "no"}`,
    `doc=${f.docDone ? "done" : "streaming"}`,
    `bytes=${f.docBytes}`,
    `data=${f.dataBack ? "back" : "none"}`,
    `online=${f.online ? "yes" : "no"}`,
    `visible=${f.visible ? "yes" : "no"}`,
    `waited=${f.waitedMs}`,
  ].join(" ");
}

function loadFacts(path: string, shownAt: number): LoadFacts {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  // The loading screen came long after the document did: a click in the app.
  const soft = !!nav && nav.responseEnd > 0 && shownAt > nav.responseEnd + 1000;
  const dataBack = performance
    .getEntriesByType("resource")
    .some((e) => e.startTime >= shownAt - 50 && e.name.includes("_rsc=") && new URL(e.name).pathname === path);
  return {
    nav: nav?.type ?? "unknown",
    soft,
    docDone: !!nav && nav.responseEnd > 0 && document.readyState !== "loading",
    docBytes: nav?.decodedBodySize ?? 0,
    dataBack,
    online: navigator.onLine,
    visible: document.visibilityState === "visible",
    waitedMs: Math.round(performance.now() - shownAt),
  };
}

// Logged like a browser error ([app:browser] SlowLoad), so a stall can be
// traced to what it was waiting on.
function reportSlowLoad(path: string, shownAt: number) {
  try {
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: errorRef(), path, name: "SlowLoad", message: loadFactsText(loadFacts(path, shownAt)) }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting is best effort.
  }
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
    const shownAt = performance.now();
    const path = location.pathname;
    const watch = watchLoading(location.pathname + location.search, storage, {
      slow: () => {
        setSlow(true);
        reportSlowLoad(path, shownAt);
      },
      reload: () => {
        reportSlowLoad(path, shownAt);
        location.reload();
      },
      unsaved: hasUnsavedWork,
    });
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
