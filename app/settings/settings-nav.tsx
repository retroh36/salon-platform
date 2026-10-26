import Link from "next/link";
import { can, type Permission } from "@/lib/permissions";

type Page = "salon" | "booking" | "policies" | "checkout" | "gift-cards" | "packages" | "events" | "memberships" | "rewards" | "automations" | "messages" | "devices" | "payroll" | "commission" | "data" | "billing";

// Each settings page and the permission it needs (lib/permissions.ts).
const LINKS: [Page, string, string, Permission][] = [
  ["salon", "/settings", "Your salon", "settings"],
  ["booking", "/settings/booking", "Online booking", "settings"],
  ["policies", "/settings/policies", "Policies", "settings"],
  ["checkout", "/settings/checkout", "Tax and receipts", "settings"],
  ["gift-cards", "/settings/gift-cards", "Gift cards", "settings"],
  ["packages", "/settings/packages", "Packages", "settings"],
  ["events", "/settings/events", "Bridal and events", "settings"],
  ["memberships", "/settings/memberships", "Memberships", "settings"],
  ["rewards", "/settings/rewards", "Rewards", "settings"],
  ["automations", "/settings/automations", "Automations", "settings"],
  ["messages", "/settings/messages", "Messages", "settings"],
  ["devices", "/settings/devices", "Shared devices", "settings"],
  ["payroll", "/settings/payroll", "Payroll", "payroll"],
  ["commission", "/settings/commission", "Commission", "payroll"],
  ["data", "/settings/data", "Your data", "export_data"],
  ["billing", "/settings/billing", "Billing", "billing"],
];

// The first settings page someone can open, for the sidebar.
export function firstSettingsPage(me: { permissions: readonly string[] }): string | null {
  return LINKS.find(([, , , p]) => can(me, p))?.[1] ?? null;
}

// Moves between the settings pages someone can open.
export function SettingsNav({ current, me }: { current: Page; me: { permissions: readonly string[] } }) {
  return (
    <nav aria-label="Settings" className="mb-8 flex flex-wrap gap-x-1 gap-y-1 border-b border-line pb-3">
      {LINKS.filter(([, , , p]) => can(me, p)).map(([key, href, label]) => (
        <Link
          key={key}
          href={href}
          aria-current={key === current ? "page" : undefined}
          className={`touch-target inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
            key === current ? "bg-navy-100 text-ink" : "text-ink-muted hover:bg-sunken hover:text-ink"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
