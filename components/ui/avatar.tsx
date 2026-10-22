// Initials in a soft circle, tinted with the person's calendar color.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "?";
}

export function Avatar({ name, color, size = "md" }: { name: string; color?: string | null; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg font-serif" };
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-navy-100 font-semibold text-navy-900 ring-2 ring-surface ${sizes[size]}`}
      style={color ? { backgroundColor: `color-mix(in srgb, ${color} 18%, white)`, boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 45%, white)` } : undefined}
    >
      {initials(name)}
    </span>
  );
}
