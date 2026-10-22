import type { StaffLevel } from "@/lib/schedule-forms";

// Stylist level colors (gold, berry, emerald) as whole class names, so
// Tailwind sees them and keeps the --color-level-* tokens.
export const LEVEL_BG: Record<StaffLevel, string> = {
  master: "bg-level-master",
  senior: "bg-level-senior",
  artisan: "bg-level-artisan",
};

// A 3px ring around an avatar, clear of it.
export const LEVEL_RING: Record<StaffLevel, string> = {
  master: "outline-3 outline-offset-2 outline-level-master",
  senior: "outline-3 outline-offset-2 outline-level-senior",
  artisan: "outline-3 outline-offset-2 outline-level-artisan",
};

// The level's mark, so it isn't shown by color alone: a star for Master,
// two dots for Senior, one dot for Artisan.
export function LevelGlyph({ level, className = "size-full" }: { level: StaffLevel; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      {level === "master" && <path d="M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9L2.4 6.3l3.9-.5z" />}
      {level === "senior" && (
        <>
          <circle cx="5" cy="8" r="2.2" />
          <circle cx="11" cy="8" r="2.2" />
        </>
      )}
      {level === "artisan" && <circle cx="8" cy="8" r="2.6" />}
    </svg>
  );
}

// The glyph in a small circle of the level's color, for the corner of an
// avatar or the legend.
export function LevelBadge({ level, className = "size-4" }: { level: StaffLevel; className?: string }) {
  return (
    <span aria-hidden data-level-badge={level} className={`inline-flex items-center justify-center rounded-full p-[2px] text-white ring-2 ring-surface ${LEVEL_BG[level]} ${className}`}>
      <LevelGlyph level={level} />
    </span>
  );
}
