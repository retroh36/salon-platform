import Link from "next/link";
import { pillClass } from "@/components/ui/page";

// Moves between the settings pages.
export function SettingsNav({ current }: { current: "salon" | "booking" }) {
  const links = [
    ["salon", "/settings", "Your salon"],
    ["booking", "/settings/booking", "Online booking"],
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
