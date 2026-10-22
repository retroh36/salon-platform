import type { StaffLevel } from "@/lib/schedule-forms";
import { LEVEL_RING, LevelBadge } from "./level";

// Initials in a soft circle, tinted with the person's calendar color. A
// stylist's level shows as a colored ring around it, with a badge in the
// corner (a star, two dots or one) so it isn't color alone.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "?";
}

const SIZES = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg font-serif", xl: "size-20 text-2xl font-serif" };
const BADGES = { sm: "size-3.5 -right-1 -bottom-1", md: "size-4 -right-1 -bottom-1", lg: "size-5 -right-0.5 -bottom-0.5", xl: "size-6 right-0 bottom-0" };

export function Avatar({
  name,
  color,
  level,
  photoUrl,
  size = "md",
  halo = true,
}: {
  name: string;
  color?: string | null;
  level?: StaffLevel | null;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  // A thin ring in the page color, to separate avatars that touch.
  halo?: boolean;
}) {
  return (
    <span aria-hidden data-level={level ?? undefined} className="relative inline-flex shrink-0">
      <span
        className={`inline-flex items-center justify-center overflow-hidden rounded-full bg-navy-100 font-semibold text-navy-900 ${halo ? "ring-2 ring-surface" : ""} ${level ? LEVEL_RING[level] : ""} ${SIZES[size]}`}
        style={color ? { backgroundColor: `color-mix(in srgb, ${color} 18%, white)`, boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 45%, white)` } : undefined}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="size-full object-cover" />
        ) : (
          initials(name)
        )}
      </span>
      {level && <LevelBadge level={level} className={`absolute ${BADGES[size]}`} />}
    </span>
  );
}
