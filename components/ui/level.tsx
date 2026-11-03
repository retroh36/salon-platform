"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LEVELS, levelOf, type Level, type LevelColor, type LevelSymbol } from "@/lib/levels";

// The salon's levels, for the avatars, badges and column bars under it.
// AppShell (and the booking site and checkout, which have their own
// frames) provides them; without a provider, every salon's starting three.
const LevelsContext = createContext<readonly Level[]>(DEFAULT_LEVELS);

export function LevelsProvider({ levels, children }: { levels: readonly Level[]; children: React.ReactNode }) {
  return <LevelsContext.Provider value={levels}>{children}</LevelsContext.Provider>;
}

export function useLevels(): readonly Level[] {
  return useContext(LevelsContext);
}

export function useLevel(key: string | null | undefined): Level | null {
  return levelOf(useContext(LevelsContext), key);
}

// Whole class names per color, so Tailwind sees them and keeps the
// --color-level-* tokens: the bright shade for the bar and ring, the
// deeper one for the badge behind its white symbol.
export const LEVEL_BG: Record<LevelColor, string> = {
  gold: "bg-level-gold",
  fuchsia: "bg-level-fuchsia",
  green: "bg-level-green",
  blue: "bg-level-blue",
  violet: "bg-level-violet",
  slate: "bg-level-slate",
};

export const LEVEL_BADGE_BG: Record<LevelColor, string> = {
  gold: "bg-level-gold-badge",
  fuchsia: "bg-level-fuchsia-badge",
  green: "bg-level-green-badge",
  blue: "bg-level-blue-badge",
  violet: "bg-level-violet-badge",
  slate: "bg-level-slate-badge",
};

// A 3px ring around an avatar, clear of it.
export const LEVEL_RING: Record<LevelColor, string> = {
  gold: "outline-3 outline-offset-2 outline-level-gold",
  fuchsia: "outline-3 outline-offset-2 outline-level-fuchsia",
  green: "outline-3 outline-offset-2 outline-level-green",
  blue: "outline-3 outline-offset-2 outline-level-blue",
  violet: "outline-3 outline-offset-2 outline-level-violet",
  slate: "outline-3 outline-offset-2 outline-level-slate",
};

// The level's mark, so it isn't shown by color alone.
export function SymbolGlyph({ symbol, className = "size-full" }: { symbol: LevelSymbol; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      {symbol === "star" && <path d="M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9L2.4 6.3l3.9-.5z" />}
      {symbol === "two_dots" && (
        <>
          <circle cx="5" cy="8" r="2.2" />
          <circle cx="11" cy="8" r="2.2" />
        </>
      )}
      {symbol === "dot" && <circle cx="8" cy="8" r="2.6" />}
      {symbol === "triangle" && <path d="M8 3.6l4.4 7.8H3.6z" />}
      {symbol === "diamond" && <path d="M8 2.6l4.6 5.4L8 13.4 3.4 8z" />}
      {symbol === "three_dots" && (
        <>
          <circle cx="3.6" cy="8" r="1.8" />
          <circle cx="8" cy="8" r="1.8" />
          <circle cx="12.4" cy="8" r="1.8" />
        </>
      )}
    </svg>
  );
}

// The symbol in a small circle of the level's badge shade, for the corner
// of an avatar or the legend. A key the salon has since removed shows
// nothing.
export function LevelBadge({ level, className = "size-4" }: { level: string; className?: string }) {
  const l = useLevel(level);
  if (!l) return null;
  return <SymbolBadge color={l.color} symbol={l.symbol} level={l.key} className={className} />;
}

export function SymbolBadge({ color, symbol, level, className = "size-4" }: { color: LevelColor; symbol: LevelSymbol; level?: string; className?: string }) {
  return (
    <span aria-hidden data-level-badge={level} data-color={color} className={`inline-flex items-center justify-center rounded-full p-[2px] text-white ring-2 ring-surface ${LEVEL_BADGE_BG[color]} ${className}`}>
      <SymbolGlyph symbol={symbol} />
    </span>
  );
}

// The bar along the top of a stylist's calendar column.
export function LevelBar({ level, className = "" }: { level: string; className?: string }) {
  const l = useLevel(level);
  if (!l) return null;
  return <span aria-hidden data-testid="level-bar" data-color={l.color} className={`${LEVEL_BG[l.color]} ${className}`} />;
}
