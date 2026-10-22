// Shared look for text inputs, selects and text areas.
export const fieldClass = [
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink",
  "transition-[border-color,box-shadow] duration-(--motion-fast)",
  "placeholder:text-ink-subtle hover:border-ink-subtle",
  "focus:border-focus focus:ring-2 focus:ring-focus/25 focus:outline-none",
  "disabled:bg-sunken disabled:text-ink-muted aria-invalid:border-danger",
].join(" ");

export const labelClass = "flex flex-col gap-1.5 text-sm font-medium text-ink";

// Small uppercase heading for a group of details, as in the mockups.
export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`text-xs font-semibold tracking-wider text-ink-muted uppercase ${className}`}>{children}</h3>;
}

// Native selects with the shared look and a chevron (.select-chevron in
// globals.css).
export const selectClass = `${fieldClass} select-chevron appearance-none pr-9`;

export const checkboxClass =
  "size-4 shrink-0 cursor-pointer rounded border-line-strong accent-navy-900 transition-transform duration-(--motion-fast) active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
