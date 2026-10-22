import type { StaffLevel } from "@/lib/schedule-forms";
import { LEVEL_RING } from "./level";

// Initials in a soft circle, tinted with the person's calendar color. A
// stylist's level shows as a colored ring around it (gold, silver, bronze).
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "?";
}

export function Avatar({
  name,
  color,
  level,
  photoUrl,
  size = "md",
}: {
  name: string;
  color?: string | null;
  level?: StaffLevel | null;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizes = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg font-serif", xl: "size-20 text-2xl font-serif" };
  return (
    <span
      aria-hidden
      data-level={level ?? undefined}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-navy-100 font-semibold text-navy-900 ring-2 ring-surface ${level ? LEVEL_RING[level] : ""} ${sizes[size]}`}
      style={color ? { backgroundColor: `color-mix(in srgb, ${color} 18%, white)`, boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 45%, white)` } : undefined}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
