import { forwardRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-navy-900 text-white shadow-card hover:bg-navy-800",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken",
  ghost: "text-ink hover:bg-sunken",
  danger: "bg-danger text-white hover:brightness-95",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-7 gap-1 px-2.5 text-xs",
  sm: "h-8 gap-1.5 px-3 text-sm",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-11 gap-2 px-5 text-base",
};

// Square, for a button that's just an icon.
const SQUARE: Record<ButtonSize, string> = { xs: "size-7", sm: "size-8", md: "size-10", lg: "size-11" };

// Shared look for buttons and button-styled links. Pressing gives instant
// feedback (a quick scale-down); focus shows a bright blue ring.
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = "", { square = false } = {}) {
  return [
    "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap select-none",
    "transition-[background-color,box-shadow,transform,filter] duration-(--motion-fast) ease-out active:scale-[0.97]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    "disabled:pointer-events-none disabled:opacity-55",
    // A finger's worth on a touchscreen, links styled as buttons too.
    "pointer-coarse:min-h-11 pointer-coarse:min-w-11",
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
