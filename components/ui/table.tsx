// Lists of records as real tables (docs/brand.md, "Tables"): a quiet header
// row, aligned columns, money and counts right-aligned in tabular figures,
// a thin rule between rows. `TableCard` is the one box around it (scrolling
// sideways on a narrow screen rather than squeezing the columns).

export function TableCard({ className = "", children, ...rest }: { className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`mb-6 overflow-x-auto overscroll-x-contain rounded-lg border border-line bg-surface ${className}`} {...rest}>
      {children}
    </div>
  );
}

export const tableClass = "w-full border-collapse text-left text-sm";
export const theadClass = "bg-sunken/70 text-xs font-medium text-ink-muted";
export const thClass = "h-9 px-4 font-medium whitespace-nowrap first:pl-4";
export const trClass = "border-t border-line transition-colors duration-(--motion-fast) hover:bg-sunken/50";
export const tdClass = "h-12 px-4 py-2 align-middle";
// Money and counts: right-aligned, digits lined up.
export const numClass = "text-right tabular-nums whitespace-nowrap";
// The row's quiet actions, at the end.
export const actionsClass = "w-px px-2 text-right whitespace-nowrap";
