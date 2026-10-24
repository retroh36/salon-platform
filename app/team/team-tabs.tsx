import Link from "next/link";

const TABS = [
  { value: "directory", href: "/team", label: "Directory" },
  { value: "schedule", href: "/schedule", label: "Schedule" },
  { value: "goals", href: "/team/goals", label: "Goals" },
] as const;

// The Team page's tabs, as links: the Directory (/team), the Schedule
// (/schedule) and, for owners and managers, Goals (/team/goals).
export function TeamTabs({ current, goals = false }: { current: (typeof TABS)[number]["value"]; goals?: boolean }) {
  return (
    <nav aria-label="Team pages" className={`mb-6 flex w-full ${goals ? "max-w-sm" : "max-w-xs"} gap-1 rounded-lg bg-sunken p-1`}>
      {TABS.filter((t) => goals || t.value !== "goals").map((t) => (
        <Link
          key={t.value}
          href={t.href}
          aria-current={t.value === current ? "page" : undefined}
          className={`flex h-9 flex-1 items-center justify-center rounded-md text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-(--motion-fast) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-focus ${
            t.value === current ? "bg-surface text-navy-900 shadow-card" : "text-ink-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
