import Link from "next/link";
import { pillClass } from "@/components/ui/page";

// Moves between the settings pages.
export function SettingsNav({ current }: { current: "salon" | "booking" | "checkout" | "gift-cards" | "packages" | "memberships" | "automations" | "payroll" | "data" }) {
  const links = [
    ["salon", "/settings", "Your salon"],
    ["booking", "/settings/booking", "Online booking"],
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
      {links.map(([key, href, label]) => (
        <Link key={key} href={href} aria-current={key === current ? "page" : undefined} className={pillClass(key === current)}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
