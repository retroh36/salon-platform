import type { StaffLevel } from "@/lib/schedule-forms";

// Stylist level colors (gold, silver, bronze) as whole class names, so
// Tailwind sees them and keeps the --color-level-* tokens.
export const LEVEL_BG: Record<StaffLevel, string> = {
  master: "bg-level-master",
  senior: "bg-level-senior",
  artisan: "bg-level-artisan",
};

export const LEVEL_BORDER: Record<StaffLevel, string> = {
  master: "border-level-master",
  senior: "border-level-senior",
  artisan: "border-level-artisan",
};

// A ring around an avatar, clear of it.
export const LEVEL_RING: Record<StaffLevel, string> = {
  master: "outline-2 outline-offset-2 outline-level-master",
  senior: "outline-2 outline-offset-2 outline-level-senior",
  artisan: "outline-2 outline-offset-2 outline-level-artisan",
};
