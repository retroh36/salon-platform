"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DeniseFace } from "@/components/denise";
import { IconButton } from "@/components/ui/button";
import { ChevronUpIcon, CloseIcon, MinimizeIcon } from "@/components/ui/icons";

// Denise's compact card (the calendar's Denise tab from lg up, and her
// bubble on Scheduling's pages): open, minimized to a small bar, or closed,
// remembered per person, per page, for this session (signing in starts her
// closed again). Only a convenience: if the browser keeps nothing, she
// starts closed.
export type CardState = "open" | "min" | "closed";

const key = (staffId: string, page: string) => `maestra:denise-card:${staffId}:${page}`;

export function rememberedCard(staffId: string, page: string): CardState | null {
  try {
    const value = sessionStorage.getItem(key(staffId, page));
    return value === "open" || value === "min" || value === "closed" ? value : null;
  } catch {
    return null;
  }
}

export function rememberCard(staffId: string, page: string, value: CardState) {
  try {
    sessionStorage.setItem(key(staffId, page), value);
  } catch {
    // Storage blocked: nothing to remember.
  }
}

// In her header, by the buttons: Meet Denise, the page on what she does
// (Settings → Denise), left out on that page itself.
export const MEET_DENISE = "/settings/denise";

export function AboutDeniseLink() {
  if (usePathname() === MEET_DENISE) return null;
  return (
    <Link
      href={MEET_DENISE}
      data-testid="about-denise"
      className="touch-target inline-flex h-8 shrink-0 items-center rounded-md px-1.5 text-13 font-medium text-denise-700 underline-offset-2 hover:text-denise-900 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
    >
      What can Denise do?
    </Link>
  );
}

// Her minimize button, in the card's header beside Close.
export function MinimizeButton({ onMinimize }: { onMinimize: () => void }) {
  return (
    <IconButton label="Minimize Denise" onClick={onMinimize} data-testid="denise-minimize">
      <MinimizeIcon />
    </IconButton>
  );
}

// The card minimized: a small bar in the corner, "Denise · 8" with how many
// things are waiting, that opens the card again (the conversation is kept).
export function MinimizedBar({ count, onOpen, onClose, className = "" }: { count: number; onOpen: () => void; onClose: () => void; className?: string }) {
  return (
    <div
      data-testid="denise-minimized"
      className={`fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex animate-pop-in items-center gap-1 rounded-full border border-denise-200 bg-surface py-1 pr-1 pl-1.5 shadow-lift ${className}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={count ? `Open Denise, ${count} to look at` : "Open Denise"}
        className="flex h-9 items-center gap-2 rounded-full pr-2 pl-0.5 text-sm font-medium text-denise-900 transition-colors duration-(--motion-fast) hover:bg-denise-50 focus-visible:outline-2 focus-visible:outline-focus"
      >
        <DeniseFace />
        <span>
          Denise
          {count > 0 && <span className="tabular-nums"> · {count}</span>}
        </span>
        <ChevronUpIcon className="size-4 text-denise-700" />
      </button>
      <IconButton label="Close Denise" size="sm" onClick={onClose}>
        <CloseIcon className="size-4" />
      </IconButton>
    </div>
  );
}
