import { forwardRef } from "react";

// One button family (docs/brand.md): `primary` (filled navy, one per page
// or panel), `secondary` (outlined), `quiet` (text, for row actions; `ghost`
// is the same) and `danger` (filled red, for the one destructive step) or
// `danger-quiet` (red text). All 36px tall (40px for `lg`, 32px for `xs` in
// dense rows; 44px on a touchscreen), the same 8px corners and icon gap.
export type ButtonVariant = "primary" | "secondary" | "quiet" | "ghost" | "danger" | "danger-quiet";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-navy-900 text-white hover:bg-navy-800",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken",
  quiet: "text-ink hover:bg-sunken",
  ghost: "text-ink hover:bg-sunken",
  danger: "bg-danger text-white hover:brightness-95",
  "danger-quiet": "text-danger hover:bg-danger-soft",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-8 gap-1.5 px-2.5 text-13",
  sm: "h-9 gap-1.5 px-3 text-sm",
  md: "h-9 gap-1.5 px-3.5 text-sm",
  lg: "h-10 gap-2 px-4 text-sm",
};

// Square, for a button that's just an icon.
const SQUARE: Record<ButtonSize, string> = { xs: "size-8", sm: "size-9", md: "size-9", lg: "size-10" };

// Shared look for buttons and button-styled links. Pressing gives instant
// feedback (a slight scale-down); focus shows a bright blue ring.
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = "", { square = false } = {}) {
  return [
    "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap select-none",
    "transition-[background-color,box-shadow,transform,filter] duration-(--motion-fast) ease-out active:scale-[0.98]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    "disabled:pointer-events-none disabled:opacity-55",
    // A finger's worth on a touchscreen, links styled as buttons too (globals.css).
    "touch-target",
    VARIANTS[variant],
    square ? SQUARE[size] : SIZES[size],
    extra,
  ].join(" ");
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; square?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", square = false, className = "", type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, className, { square })} {...props} />;
});

// A square button holding just an icon; `label` names it.
export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  className = "",
  children,
  ...props
}: Omit<ButtonProps, "aria-label"> & { label: string }) {
  return (
    <Button aria-label={label} title={label} variant={variant} size={size} square className={className} {...props}>
      {children}
    </Button>
  );
}
