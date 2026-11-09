import Link from "next/link";
import { can, type Permission } from "@/lib/permissions";

type Page = "salon" | "levels" | "roles" | "stations" | "time-off" | "booking" | "booking-page" | "policies" | "checkout" | "gift-cards" | "packages" | "events" | "memberships" | "rewards" | "automations" | "messages" | "payments" | "devices" | "payroll" | "commission" | "data" | "import" | "billing" | "denise";

// Each settings page and the permission it needs (lib/permissions.ts);
// null is everyone on the team.
const LINKS: [Page, string, string, Permission | null][] = [
  ["salon", "/settings", "Your salon", "settings"],
  ["levels", "/settings/levels", "Levels", "settings"],
  ["roles", "/settings/roles", "Working roles", "settings"],
  ["stations", "/settings/stations", "Stations", "settings"],
  ["time-off", "/settings/time-off", "Time off", "settings"],
  ["booking", "/settings/booking", "Online booking", "settings"],
  ["booking-page", "/settings/booking-page", "Booking page", "settings"],
  ["policies", "/settings/policies", "Policies", "settings"],
  ["checkout", "/settings/checkout", "Tax and receipts", "settings"],
  ["gift-cards", "/settings/gift-cards", "Gift cards", "settings"],
  ["packages", "/settings/packages", "Packages", "settings"],
  ["events", "/settings/events", "Bridal and events", "settings"],
  ["memberships", "/settings/memberships", "Memberships", "settings"],
  ["rewards", "/settings/rewards", "Rewards", "settings"],
  ["automations", "/settings/automations", "Automations", "settings"],
  ["messages", "/settings/messages", "Messages", "settings"],
  ["payments", "/settings/payments", "Payments", "settings"],
  ["devices", "/settings/devices", "Shared devices", "settings"],
  ["payroll", "/settings/payroll", "Payroll", "payroll"],
  ["commission", "/settings/commission", "Commission", "payroll"],
  ["data", "/settings/data", "Your data", "export_data"],
  ["import", "/settings/import", "Import clients", "settings"],
  ["billing", "/settings/billing", "Billing", "billing"],
  ["denise", "/settings/denise", "Denise", null],
];

const open = (me: { permissions: readonly string[] }, p: Permission | null) => p === null || can(me, p);

// The first settings page someone can open, for the sidebar: only the
// salon's own settings (Meet Denise is reached from her header and the
// help guide).
export function firstSettingsPage(me: { permissions: readonly string[] }): string | null {
  return LINKS.find(([, , , p]) => p !== null && can(me, p))?.[1] ?? null;
}

// Moves between the settings pages someone can open.
export function SettingsNav({ current, me }: { current: Page; me: { permissions: readonly string[] } }) {
  return (
    <nav aria-label="Settings" className="mb-8 flex flex-wrap gap-x-1 gap-y-1 border-b border-line pb-3">
      {LINKS.filter(([, , , p]) => open(me, p)).map(([key, href, label]) => (
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
