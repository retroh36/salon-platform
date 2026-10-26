// Loading placeholders and toasts, the same everywhere (docs/brand.md).

// A soft placeholder that shimmers slowly while something loads (still,
// with reduced motion). Give it a size with `className`.
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={`animate-skeleton rounded-md bg-sunken ${className}`} style={style} />;
}

// A toast: a short message at the foot of the screen, navy, with at most
// one action (Undo).
export const toastClass =
  "fixed bottom-6 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-toast-in items-center gap-4 rounded-lg bg-navy-900 px-4 py-3 text-sm text-white shadow-lift";
export const toastActionClass = "font-semibold text-white underline underline-offset-2 hover:text-navy-100";
