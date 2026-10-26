import Image from "next/image";
import wave from "@/public/brand/denise/wave.png";

// Building blocks for pages: header, cards, sections, tags, alerts and
// empty states (docs/brand.md, "Layout"). One layer of containers: only
// the items themselves are cards; groups of them are a Section (a label and
// a thin rule), never a box around boxes.

// The page title (24px semibold), an optional line below and the page's
// actions on the right (at most one primary).
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.015em] text-ink">{title}</h1>
        {description && <div className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// A white card: a 1px border, 8px corners, no shadow. With a title, it gets
// a header row (title, optional actions) and the body below; `flush` drops
// the body padding for lists and tables.
export function Card({
  title,
  titleId,
  description,
  actions,
  flush = false,
  className = "",
  as: Tag = "section",
  children,
  ...rest
}: {
  title?: React.ReactNode;
  titleId?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  flush?: boolean;
  className?: string;
  as?: "section" | "div";
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <Tag className={`mb-6 overflow-hidden rounded-lg border border-line bg-surface ${className}`} aria-labelledby={title && titleId ? titleId : undefined} {...rest}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-13 text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </Tag>
  );
}

// A group on the page without a box: its title (16px semibold) and actions
// over a thin rule, then the items (cards, a table, rows).
export function Section({
  title,
  titleId,
  description,
  actions,
  count,
  className = "",
  children,
  ...rest
}: {
  title: React.ReactNode;
  titleId?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  count?: number;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section className={`mb-8 ${className}`} aria-labelledby={titleId} {...rest}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
            {/* The count, quiet on screen; read as "Color formulas (2)". */}
            {count != null && (
              <>
                {" "}
                <span aria-hidden className="ml-0.5 text-13 font-normal text-ink-subtle tabular-nums">
                  {count}
                </span>
                <span className="sr-only">({count})</span>
              </>
            )}
          </h2>
          {description && <p className="mt-0.5 text-13 text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

// Status colors: one set for tags, alerts and notices.
export type Tone = "neutral" | "navy" | "green" | "blue" | "amber" | "red" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, { fill: string; dot: string }> = {
  neutral: { fill: "bg-neutral-soft text-neutral", dot: "bg-neutral-dot" },
  navy: { fill: "bg-neutral-soft text-neutral", dot: "bg-neutral-dot" },
  green: { fill: "bg-success-soft text-success", dot: "bg-success-dot" },
  success: { fill: "bg-success-soft text-success", dot: "bg-success-dot" },
  blue: { fill: "bg-info-soft text-info", dot: "bg-info-dot" },
  info: { fill: "bg-info-soft text-info", dot: "bg-info-dot" },
  amber: { fill: "bg-warning-soft text-warning", dot: "bg-warning-dot" },
  warning: { fill: "bg-warning-soft text-warning", dot: "bg-warning-dot" },
  red: { fill: "bg-danger-soft text-danger", dot: "bg-danger-dot" },
  danger: { fill: "bg-danger-soft text-danger", dot: "bg-danger-dot" },
};

// A small status tag: a dot and a short label ("Charged", "No card on file").
// `wrap` lets a long tag run onto a second line instead of past the edge.
export function Badge({ tone = "neutral", dot = true, wrap = false, className = "", children }: { tone?: Tone; dot?: boolean; wrap?: boolean; className?: string; children: React.ReactNode }) {
  const shape = wrap ? "min-h-5 py-0.5 items-start" : "h-5 items-center whitespace-nowrap";
  return (
    <span className={`inline-flex gap-1.5 rounded-sm px-1.5 text-xs font-medium ${shape} ${TONES[tone].fill} ${className}`}>
      {dot && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${TONES[tone].dot} ${wrap ? "mt-[5px]" : ""}`} />}
      {children}
    </span>
  );
}

const ALERTS = {
  error: TONES.danger,
  warning: TONES.warning,
  success: TONES.success,
  info: TONES.info,
};

// A message across the page or a panel: the soft fill, a dot and the text.
// Errors are announced (role="alert"); others are polite.
export function Alert({ tone = "error", className = "", children }: { tone?: keyof typeof ALERTS; className?: string; children: React.ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex animate-fade-in items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm ${ALERTS[tone].fill} ${className}`}>
      <span aria-hidden className={`mt-[7px] size-1.5 shrink-0 rounded-full ${ALERTS[tone].dot}`} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// Nothing to show: one quiet line (and an optional title and action),
// centered, the same everywhere.
// Denise waves above it (art={false} leaves her out, in tight spaces).
export function EmptyState({
  title,
  action,
  art = true,
  className = "",
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  art?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col items-center gap-1 px-4 py-10 text-center ${className}`} data-testid="empty-state">
      {art && <Image src={wave} alt="" aria-hidden sizes="64px" className="mb-2 h-auto w-14" />}
      {title && <p className="text-sm font-medium text-ink">{title}</p>}
      {children && <p className="text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// Rows inside a flush Card's list, with a hover tint.
export const listClass = "divide-y divide-line";
export const rowClass = "px-4 py-3 transition-colors duration-(--motion-fast)";
export const rowLinkClass =
  "flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none";

// A link for picking one of several (a team member, a period), or a
// secondary button-styled link: the button family's shape (never a pill),
// navy when it's the one selected.
export function pillClass(selected: boolean) {
  return `touch-target inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium whitespace-nowrap transition-[background-color,color,border-color,transform] duration-(--motion-fast) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
    selected ? "border-navy-900 bg-navy-900 text-white" : "border-line-strong bg-surface text-ink hover:bg-sunken"
  }`;
}

// A person's or a record's name as a link: dark text, underlined on hover
// (the link blue is for links that read as links, like "See all").
export const nameLinkClass = "font-medium text-ink underline-offset-2 hover:underline focus-visible:underline";
// A text link: the link blue.
export const textLinkClass = "font-medium text-link underline-offset-2 hover:text-link-hover hover:underline";
