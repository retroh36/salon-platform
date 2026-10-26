"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { Sheet } from "./ui/sheet";

// Half-filled forms in a side panel (a new booking, a group, blocked time,
// a walk-in): leaving one asks first, so nothing typed is lost by a stray
// tap. A form says it has changes with `useUnsavedChanges`; the page that
// holds it wraps what would throw them away in `leave` from
// `useLeaveGuard`, which also covers links, reloads and closing the tab.

const UnsavedContext = createContext<(dirty: boolean) => void>(() => {});

export function useUnsavedChanges(dirty: boolean) {
  const set = useContext(UnsavedContext);
  useEffect(() => {
    set(dirty);
    return () => set(false);
  }, [dirty, set]);
}

export function useLeaveGuard() {
  const router = useRouter();
  const dirty = useRef(false);
  const [asking, setAsking] = useState<{ go: () => void; discard?: () => void } | null>(null);
  const set = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);
  // `go` now, or once they say to discard the changes (`discard` first).
  const leave = useCallback((go: () => void, discard?: () => void) => {
    if (dirty.current) setAsking({ go, discard });
    else go();
  }, []);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    // Ahead of the link's own handling, so it goes nowhere until they say.
    const onClick = (e: MouseEvent) => {
      if (!dirty.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      setAsking({ go: () => router.push(url.pathname + url.search + url.hash) });
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [router]);

  const dialog = asking && (
    <Sheet title="Leave without saving?" onClose={() => setAsking(null)}>
      <p className="text-sm text-ink-muted">What you&apos;ve filled in here hasn&apos;t been saved, and will be lost.</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button
          onClick={() => {
            dirty.current = false;
            setAsking(null);
            asking.discard?.();
            asking.go();
          }}
        >
          Discard changes
        </Button>
        <Button variant="primary" onClick={() => setAsking(null)}>
          Keep editing
        </Button>
      </div>
    </Sheet>
  );

  return { leave, dialog, Provider: UnsavedContext.Provider, set };
}
