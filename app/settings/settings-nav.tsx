import Link from "next/link";
import { pillClass } from "@/components/ui/page";
import type { StaffRole } from "@/lib/staff";

// Settings pages managers can open (read-only); the rest are owners'.
export const MANAGER_SETTINGS = ["automations"] as const;

// Moves between the settings pages (managers see only theirs).
export function SettingsNav({ current, role = "owner" }: { current: "salon" | "booking" | "policies" | "checkout" | "gift-cards" | "packages" | "memberships" | "automations" | "payroll" | "data"; role?: StaffRole }) {
  const links = [
    ["salon", "/settings", "Your salon"],
    ["booking", "/settings/booking", "Online booking"],
    ["policies", "/settings/policies", "Policies"],
    ["checkout", "/settings/checkout", "Tax and receipts"],
    ["gift-cards", "/settings/gift-cards", "Gift cards"],
    ["packages", "/settings/packages", "Packages"],
    ["memberships", "/settings/memberships", "Memberships"],
    ["automations", "/settings/automations", "Automations"],
    ["payroll", "/settings/payroll", "Payroll"],
    ["data", "/settings/data", "Your data"],
  ] as const;
  return (
    <nav aria-label="Settings" className="mb-6 flex flex-wrap gap-2">
      {links.filter(([key]) => role === "owner" || (MANAGER_SETTINGS as readonly string[]).includes(key)).map(([key, href, label]) => (
        <Link key={key} href={href} aria-current={key === current ? "page" : undefined} className={pillClass(key === current)}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
