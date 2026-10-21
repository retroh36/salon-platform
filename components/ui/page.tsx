// Building blocks for pages: header, cards, badges, alerts and empty states.

// The page title in the serif face, with an optional line below and
// actions on the right.
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-plum-900">{title}</h1>
        {description && <div className="mt-1 text-ink-muted">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// A white card. With a title, it gets a header row (title, optional
// actions) and the body below; `flush` drops the body padding for lists.
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
    <Tag className={`mb-6 overflow-hidden rounded-xl border border-line bg-surface shadow-card ${className}`} aria-labelledby={title && titleId ? titleId : undefined} {...rest}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <div>
            <h2 id={titleId} className="font-serif text-lg font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="text-sm text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </Tag>
  );
}

export type Tone = "neutral" | "plum" | "green" | "blue" | "amber" | "red";

const TONES: Record<Tone, string> = {
  neutral: "bg-status-booked-bg text-status-booked-ink",
  plum: "bg-status-completed-bg text-status-completed-ink",
  green: "bg-status-confirmed-bg text-status-confirmed-ink",
  blue: "bg-status-checked-in-bg text-status-checked-in-ink",
  amber: "bg-status-late-bg text-status-late-ink",
  red: "bg-status-no-show-bg text-status-no-show-ink",
};

export function Badge({ tone = "neutral", className = "", children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONES[tone]} ${className}`}>{children}</span>;
}

const ALERTS = {
  error: "border-danger/30 bg-danger-soft text-danger",
  success: "border-status-confirmed-ink/25 bg-status-confirmed-bg text-status-confirmed-ink",
  info: "border-plum-200 bg-plum-100 text-plum-900",
};

// A message box. Errors are announced (role="alert"); others are polite.
export function Alert({ tone = "error", className = "", children }: { tone?: keyof typeof ALERTS; className?: string; children: React.ReactNode }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`animate-fade-in rounded-md border px-3 py-2 text-sm ${ALERTS[tone]} ${className}`}>
      {children}
    </p>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-ink-muted">{children}</p>;
}

// Rows inside a flush Card's list, with a hover tint.
export const listClass = "divide-y divide-line";
export const rowClass = "px-5 py-3.5 transition-colors duration-(--motion-fast)";
export const rowLinkClass =
  "flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none";

// A pill link for picking one of several (e.g. a team member).
export function pillClass(selected: boolean) {
  return `inline-flex h-8 items-center rounded-full border px-3.5 text-sm font-medium transition-[background-color,color,border-color,transform] duration-(--motion-fast) active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum-700 ${
    selected ? "border-plum-900 bg-plum-900 text-white" : "border-line-strong bg-surface text-ink hover:bg-sunken"
  }`;
}
