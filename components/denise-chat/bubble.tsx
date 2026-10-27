"use client";

import { useEffect } from "react";
import { DeniseFace, DenisePose } from "@/components/denise";
import { IconButton } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { DeniseChat } from "./chat";
import { focusDenise, hydrateDenise, setDeniseOpen, useDenise } from "./store";

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
// the right; on a phone it fills the screen, with a close button. `launcher`
// "header": the page shows its own button (the checkout's, in its top bar).
export function DeniseBubble({ me, launcher = "corner" }: { me: BubbleMe; launcher?: "corner" | "header" }) {
  const { open, staffId } = useDenise();
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
  const shown = open && staffId === me.staffId;

  return (
    <>
      {!shown && launcher === "corner" && <DeniseLauncherButton />}
      {shown && (
        <aside
          aria-label="Denise"
          data-denise-panel
          data-testid="denise-bubble"
          className={`fixed inset-0 z-50 flex animate-fade-in flex-col border-line bg-surface md:z-auto md:w-[22rem] md:shrink-0 md:border-l ${
            // The checkout's row is already the screen's height.
            launcher === "header" ? "md:static" : "md:sticky md:top-0 md:h-[calc(100dvh-var(--demo-bar))] md:self-start lg:h-auto lg:self-stretch"
          }`}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
            <DenisePose pose="wave" className="w-9" />
            <h2 className="flex-1 text-base font-semibold text-ink">Denise</h2>
            <IconButton label="Close Denise" onClick={() => setDeniseOpen(false)}>
              <CloseIcon />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 text-sm">
            <DeniseChat
              canBook={me.canBook}
              today={me.today}
              date={me.today}
              placeholder={me.canBook ? "Find a haircut after 1 PM" : undefined}
              intro={
                <p className="rounded-lg rounded-bl-sm bg-denise-50 px-3 py-2 text-denise-900">
                  {me.canBook
                    ? `Hi ${me.firstName}. Ask me anything, or type a booking the way the client says it: “John Williams wants a cut with Gil on a Thursday morning.”`
                    : `Hi ${me.firstName}. Ask me about your day, your clients or how to do something.`}
                </p>
              }
            />
          </div>
        </aside>
      )}
    </>
  );
}

// Her face in the corner while the panel is closed.
function DeniseLauncherButton() {
  return (
    <button
      type="button"
      onClick={focusDenise}
      aria-label="Open Denise"
      aria-keyshortcuts={DENISE_SHORTCUT}
      title={`Denise (${SHORTCUT_TEXT})`}
      data-testid="denise-bubble-launcher"
      className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex size-14 animate-pop-in items-center justify-center rounded-full bg-surface shadow-lift ring-1 ring-denise-200 transition-transform duration-(--motion-fast) hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-95"
    >
      <DeniseFace size={46} />
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
