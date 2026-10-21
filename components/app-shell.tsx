import Link from "next/link";
import { logout } from "@/app/login/actions";

type Section = "dashboard" | "calendar" | "clients" | "schedule" | "services";

const NAV: { section: Section; href: string; label: string }[] = [
  { section: "dashboard", href: "/dashboard", label: "Dashboard" },
  { section: "calendar", href: "/calendar", label: "Calendar" },
  { section: "clients", href: "/clients", label: "Clients" },
  { section: "schedule", href: "/schedule", label: "Schedule" },
  { section: "services", href: "/services", label: "Services" },
];

// `section` comes from the page rather than usePathname(), which would make
// the prerendered loading shell depend on the request URL.
export function AppShell({
  section,
  businessName,
  userName,
  wide = false,
  children,
}: {
  section?: Section;
  businessName?: string;
  userName?: string;
  // Full width, for the calendar.
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col bg-neutral-50 text-neutral-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="font-semibold">{businessName ?? "Salon Platform"}</span>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.section === section ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 ${item.section === section ? "bg-neutral-100 font-medium text-neutral-900" : "text-neutral-600 hover:text-neutral-900"}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {userName && <span className="text-neutral-600">Hi, {userName}</span>}
          <form action={logout}>
            <button type="submit" className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className={`mx-auto w-full px-6 py-8 ${wide ? "" : "max-w-4xl"}`}>{children}</main>
    </div>
  );
}

export function NotLinked() {
  return (
    <AppShell>
      <p className="text-neutral-600">
        Your account isn&apos;t linked to a salon yet. Ask the salon owner to add you as staff.
      </p>
    </AppShell>
  );
}

export function LoadingShell() {
  return (
    <AppShell>
      <p className="text-neutral-500">Loading…</p>
    </AppShell>
  );
}
