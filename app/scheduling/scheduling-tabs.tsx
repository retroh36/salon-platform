import Link from "next/link";

const TABS = [
  { value: "team", href: "/scheduling", label: "Team schedule" },
] as const;

// Scheduling's pages, as links.
export function SchedulingTabs({ current }: { current: (typeof TABS)[number]["value"] }) {
  return (
    <nav aria-label="Scheduling pages" className="mb-6 flex w-full max-w-md gap-1 rounded-lg bg-sunken p-1">
      {TABS.map((t) => (
        <Link
          key={t.value}
          href={t.href}
          aria-current={t.value === current ? "page" : undefined}
          className={`flex h-9 flex-1 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-(--motion-fast) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-focus ${
            t.value === current ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
