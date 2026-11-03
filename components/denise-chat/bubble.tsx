"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DeniseFace } from "@/components/denise";
import { IconButton } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { MinimizedBar, MinimizeButton, rememberCard, rememberedCard } from "./card";
import { DeniseAskBox, DeniseChat } from "./chat";
import { focusDenise, hydrateDenise, setDeniseMin, setDeniseOpen, useDenise } from "./store";

// The shortcut that opens Denise from anywhere, with the cursor in her
// message box: ⌘K on a Mac or iPad keyboard, Ctrl+K elsewhere.
export const DENISE_SHORTCUT = "Meta+K Control+K";
export const SHORTCUT_TEXT = "⌘K or Ctrl+K";

export function useDeniseShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      onOpen();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpen]);
}

export type BubbleMe = { staffId: string; firstName: string; canBook: boolean; today: string };

// Denise on every staff page but the calendar (which has her in its own
// side panel): her face in the bottom right corner, and her chat in a panel
// that sits beside the page rather than over it, so the page's own buttons
// (Complete sale, Save) stay in reach. At iPad width and up it's a column on
// the right; on a phone it fills the screen, with a close button. The face
// never covers the page: pages leave room under their last row (AppFrame's
// `pb-24`), and while a button, link or field is under it, it tucks into a
// small tab at the window's edge (`useTucked`). "Ask Denise" in the sidebar
// opens her too. `launcher` "header": the page shows its own button (the
// checkout's, in its top bar). `overlay`: on a page whose point is the whole
// team at once (Scheduling), she's a compact card over the corner from md
// up instead, so the page keeps its full width: only as tall as what's in
// it, minimized to a small bar or closed, as last left on that page.
export function DeniseBubble({ me, launcher = "corner", overlay = false }: { me: BubbleMe; launcher?: "corner" | "header"; overlay?: boolean }) {
  const { open, staffId, min } = useDenise();
  useEffect(() => hydrateDenise(me.staffId), [me.staffId]);
  useDeniseShortcut(focusDenise);
  // Escape closes her (unless a menu or picker inside is open).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-denise-panel]") || target.closest("[role=dialog], [role=listbox]")) return;
      e.preventDefault();
      setDeniseOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  // Minimized on a page with her card (Scheduling), she stays out of the
  // way elsewhere too: her face in the corner until she's opened.
  const shown = open && staffId === me.staffId && (overlay || !min);
  const page = usePathname();
  // The card as it was last left on this page, once the chat is loaded;
  // then every change is remembered.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!overlay || staffId !== me.staffId) return;
    const was = rememberedCard(me.staffId, page);
    if (was) {
      setDeniseOpen(was !== "closed");
      setDeniseMin(was === "min");
    }
    restored.current = page;
  }, [overlay, staffId, me.staffId, page]);
  useEffect(() => {
    if (overlay && restored.current === page) rememberCard(me.staffId, page, !shown ? "closed" : min ? "min" : "open");
  }, [overlay, page, shown, min, me.staffId]);
  const minimized = overlay && shown && min;

  return (
    <>
      {!shown && launcher === "corner" && <DeniseLauncherButton />}
      {minimized && <MinimizedBar count={0} onOpen={() => setDeniseMin(false)} onClose={() => setDeniseOpen(false)} className="hidden md:flex" />}
      {shown && (
        <aside
          aria-label="Denise"
          data-denise-panel
          data-testid="denise-bubble"
          data-overlay={overlay || undefined}
          className={`fixed inset-0 z-50 flex animate-fade-in flex-col border-line bg-surface ${
            overlay
              ? `md:inset-auto md:right-4 md:bottom-4 md:max-h-[min(34rem,calc(100dvh-2rem-var(--demo-bar)))] md:w-[23.75rem] md:overflow-hidden md:rounded-xl md:border md:shadow-panel ${minimized ? "md:hidden" : ""}`
              : `md:z-auto md:w-[22rem] md:shrink-0 md:border-l ${
                  // The checkout's row is already the screen's height.
                  launcher === "header" ? "md:static" : "md:sticky md:top-0 md:h-[calc(100dvh-var(--demo-bar))] md:self-start lg:h-auto lg:self-stretch"
                }`
          }`}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
            <DeniseFace />
            <h2 className="flex-1 text-base font-semibold text-ink">Denise</h2>
            {overlay && <MinimizeButton onMinimize={() => setDeniseMin(true)} />}
            <IconButton label="Close Denise" onClick={() => setDeniseOpen(false)}>
              <CloseIcon />
            </IconButton>
          </div>
          {/* The header stays at the top and her message box at the bottom;
              the conversation scrolls between them. */}
          <div className={`min-h-0 overflow-y-auto px-4 pt-3 pb-3 text-sm ${overlay ? "flex-1 md:flex-initial" : "flex-1"}`}>
            <DeniseChat
              box={false}
              canBook={me.canBook}
              today={me.today}
              date={me.today}
              intro={
                <p className="rounded-lg rounded-bl-sm bg-denise-50 px-3 py-2 text-denise-900">
                  {me.canBook
                    ? `Hi ${me.firstName}. Ask me anything, or type a booking the way the client says it: “John Williams wants a cut with Gil on a Thursday morning.”`
                    : `Hi ${me.firstName}. Ask me about your day, your clients or how to do something.`}
                </p>
              }
            />
          </div>
          <DeniseAskBox canBook={me.canBook} date={me.today} placeholder={me.canBook ? "Find a haircut after 1 PM" : undefined} />
        </aside>
      )}
    </>
  );
}

// Her face in the corner while the panel is closed, tucked into a tab at
// the window's edge while something the page needs is under it.
function DeniseLauncherButton() {
  const ref = useRef<HTMLButtonElement>(null);
  const tucked = useTucked(ref);
  return (
    <button
      ref={ref}
      type="button"
      onClick={focusDenise}
      aria-label="Open Denise"
      aria-keyshortcuts={DENISE_SHORTCUT}
      title={`Denise (${SHORTCUT_TEXT})`}
      data-testid="denise-bubble-launcher"
      data-tucked={tucked || undefined}
      className={`fixed bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex animate-pop-in items-center justify-center bg-surface shadow-lift ring-1 ring-denise-200 transition-[right,width,height,border-radius,transform] duration-(--motion-base) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-95 ${
        tucked ? "right-0 h-12 w-7 rounded-l-full pl-1" : "right-4 size-14 rounded-full hover:-translate-y-0.5"
      }`}
    >
      <DeniseFace size={tucked ? 20 : 46} />
    </button>
  );
}

// The full bubble's spot (16px in from the corner, 56px across).
const SPOT = 56;
const INSET = 16;
const INTERACTIVE = "a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=switch], [role=tab]";

// Whether something the person can use (a button, link or field) is in the
// bubble's spot just now, checked as the page scrolls, resizes or changes.
function useTucked(ref: React.RefObject<HTMLElement | null>): boolean {
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const right = innerWidth - INSET;
      const bottom = innerHeight - Math.max(INSET, 0);
      const points: [number, number][] = [];
      // 2px in from each edge: a button just under the edge counts.
      for (const dx of [2, SPOT / 2, SPOT - 2]) for (const dy of [2, SPOT / 2, SPOT - 2]) points.push([right - SPOT + dx, bottom - SPOT + dy]);
      const covered = points.some(([x, y]) =>
        document.elementsFromPoint(x, y).some((el) => !ref.current?.contains(el) && !el.closest("[data-denise-panel]") && el.closest(INTERACTIVE) !== null),
      );
      setTucked(covered);
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    document.addEventListener("scroll", soon, { capture: true, passive: true });
    addEventListener("resize", soon);
    const changes = new MutationObserver(soon);
    changes.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", soon, { capture: true });
      removeEventListener("resize", soon);
      changes.disconnect();
    };
  }, [ref]);
  return tucked;
}

// "Ask Denise" in the sidebar, above who's signed in: a second way in.
export function DeniseSidebarButton() {
  const { open, min } = useDenise();
  return (
    <button
      type="button"
      onClick={() => (open && !min ? setDeniseOpen(false) : focusDenise())}
      aria-keyshortcuts={DENISE_SHORTCUT}
      aria-expanded={open}
      title={`Denise (${SHORTCUT_TEXT})`}
      data-testid="denise-sidebar-launcher"
      className="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm font-medium text-sidebar-text transition-colors duration-(--motion-fast) hover:bg-sidebar-hover hover:text-white focus-visible:outline-2 focus-visible:outline-sidebar-focus aria-expanded:bg-sidebar-hover aria-expanded:text-white"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface">
        <DeniseFace size={24} />
      </span>
      Ask Denise
    </button>
  );
}

// The checkout's own button for her, in its top bar (nothing floats over
// the payment column there).
export function DeniseHeaderButton() {
  const { open } = useDenise();
  return (
    <button
      type="button"
      onClick={() => (open ? setDeniseOpen(false) : focusDenise())}
      aria-label={open ? "Close Denise" : "Open Denise"}
      aria-keyshortcuts={DENISE_SHORTCUT}
      aria-expanded={open}
      title={`Denise (${SHORTCUT_TEXT})`}
      data-testid="denise-bubble-launcher"
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-denise-200 transition-transform duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-95"
    >
      <DeniseFace size={36} />
    </button>
  );
}
