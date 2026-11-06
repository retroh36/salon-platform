import Link from "next/link";

const TABS = [
  { value: "team", href: "/scheduling", label: "Team schedule" },
  { value: "floor", href: "/scheduling/floor", label: "Floor today" },
  { value: "requests", href: "/scheduling/requests", label: "Requests" },
  { value: "balances", href: "/scheduling/balances", label: "Balances" },
] as const;

// Scheduling's pages, as links. Requests (with how many are waiting) and
// time off balances are for owners and managers.
export function SchedulingTabs({ current, pending }: { current: (typeof TABS)[number]["value"]; pending?: number | null }) {
  return (
    <nav aria-label="Scheduling pages" className="mb-6 flex w-full max-w-2xl gap-1 rounded-lg bg-sunken p-1">
      {TABS.filter((t) => (t.value !== "requests" && t.value !== "balances") || pending != null).map((t) => (
        <Link
          key={t.value}
          href={t.href}
          aria-current={t.value === current ? "page" : undefined}
          className={`flex h-9 flex-1 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-(--motion-fast) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-focus ${
            t.value === current ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-muted hover:text-ink"
          }`}
        >
          {t.label}
          {t.value === "requests" && pending ? ` (${pending})` : ""}
        </Link>
      ))}
    </nav>
  );
}

// Week or Month of the team schedule, keeping the place: the month the week
// starts in, or the month's first week.
export function RangeSwitch({ current, week, month }: { current: "week" | "month"; week?: string; month?: string }) {
  const options = [
    { value: "week", label: "Week", href: week ? `/scheduling?week=${week}` : `/scheduling?week=${month}-01` },
    { value: "month", label: "Month", href: month ? `/scheduling/month?month=${month}` : `/scheduling/month?month=${week!.slice(0, 7)}` },
  ] as const;
  return (
    <nav aria-label="Show" className="inline-flex h-9 items-center rounded-md border border-line bg-surface p-0.5">
      {options.map((o) =>
        o.value === current ? (
          <span key={o.value} aria-current="page" className="inline-flex h-full items-center rounded bg-active-soft px-3 text-sm font-medium text-active-ink">
            {o.label}
          </span>
        ) : (
          <Link key={o.value} href={o.href} className="inline-flex h-full items-center rounded px-3 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">
            {o.label}
          </Link>
        ),
      )}
    </nav>
  );
}
