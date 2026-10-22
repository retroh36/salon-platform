import Link from "next/link";
import { logout } from "@/app/login/actions";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { BoxIcon, CalendarIcon, ClockIcon, ClipboardIcon, HomeIcon, LogOutIcon, ScissorsIcon, SearchIcon, SettingsIcon, TeamIcon, UserIcon } from "@/components/ui/icons";
import { SalonMark } from "@/components/ui/salon-mark";
import { roleLabel, type StaffRole } from "@/lib/staff";

export type Section = "dashboard" | "my-day" | "calendar" | "clients" | "schedule" | "services" | "durations" | "inventory" | "forms" | "settings";

type NavItem = { section: Section; href: string; label: string; Icon: (p: { className?: string }) => React.ReactNode; ownersOnly?: boolean; managersOnly?: boolean; stylistsOnly?: boolean };

const NAV: NavItem[] = [
  { section: "dashboard", href: "/dashboard", label: "Dashboard", Icon: HomeIcon },
  { section: "my-day", href: "/my-day", label: "My day", Icon: ClockIcon, stylistsOnly: true },
  { section: "calendar", href: "/calendar", label: "Calendar", Icon: CalendarIcon },
  { section: "clients", href: "/clients", label: "Clients", Icon: UserIcon },
  { section: "schedule", href: "/schedule", label: "Team schedule", Icon: TeamIcon },
  { section: "services", href: "/services", label: "Services", Icon: ScissorsIcon },
  { section: "durations", href: "/durations", label: "Durations", Icon: ClockIcon, managersOnly: true },
  { section: "inventory", href: "/inventory", label: "Inventory", Icon: BoxIcon },
  { section: "forms", href: "/forms", label: "Forms", Icon: ClipboardIcon },
  { section: "settings", href: "/settings", label: "Settings", Icon: SettingsIcon, ownersOnly: true },
];

function shown(item: NavItem, role: StaffRole): boolean {
  return (!item.ownersOnly || role === "owner") && (!item.managersOnly || role === "owner" || role === "manager") && (!item.stylistsOnly || role === "stylist");
}

// "Powered by Maestra", small, at the foot of the sidebar.
function PoweredBy() {
  return (
    <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-subtle" data-testid="powered-by">
      Powered by
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/maestra/maestra-mark.svg" alt="" className="h-3 w-auto" />
      <span className="font-semibold text-ink-muted">Maestra</span>
    </p>
  );
}

// The redesigned app layout (docs/design/): sidebar with the salon and
// navigation, a search bar on top. Pages move to it one at a time; the rest
// still use AppShell.
export function AppFrame({
  section,
  businessName,
  logoUrl,
  locationName,
  user,
  children,
}: {
  section: Section;
  businessName: string;
  logoUrl: string | null;
  locationName: string;
  user: { name: string; role: StaffRole };
  children: React.ReactNode;
}) {
  return (
    // One screen tall on large screens: the calendar and panels scroll inside.
    <div className="flex min-h-screen flex-1 bg-canvas text-ink lg:h-screen lg:min-h-0 lg:flex-none lg:overflow-hidden">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-sunken/60 lg:flex">
        <div className="flex items-center gap-3 px-5 pt-6 pb-5">
          <SalonMark name={businessName} logoUrl={logoUrl} />
          <div className="min-w-0">
            <div className="font-serif text-lg leading-tight font-semibold text-navy-900">{businessName}</div>
            <div className="mt-0.5 text-sm leading-tight text-ink-muted">{locationName}</div>
          </div>
        </div>
        {/* Scrolls on short screens, so it never runs into the footer. */}
        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
          {NAV.filter((n) => shown(n, user.role)).map(({ section: s, href, label, Icon }) => {
            const current = s === section;
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? "page" : undefined}
                className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-[background-color,color,transform] duration-(--motion-fast) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-focus ${
                  current ? "bg-navy-100 text-navy-900" : "text-ink-muted hover:bg-surface hover:text-ink"
                }`}
              >
                <Icon className="size-5" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-line px-4 pt-4 pb-3" data-testid="sidebar-footer">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} size="sm" halo={false} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="truncate text-xs text-ink-muted">{roleLabel(user.role)}</div>
            </div>
            <form action={logout} className="shrink-0">
              <button type="submit" aria-label="Sign out" title="Sign out" className={buttonClass("ghost", "sm", "", { square: true })}>
                <LogOutIcon className="size-4" />
              </button>
            </form>
          </div>
          <PoweredBy />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-canvas px-4 py-3 sm:px-6">
          {/* Compact header for screens without the sidebar. */}
          <div className="flex items-center gap-2 lg:hidden">
            <SalonMark name={businessName} logoUrl={logoUrl} />
            <span className="font-serif font-semibold text-navy-900">{businessName}</span>
          </div>
          <form action="/clients" role="search" className="relative ml-auto w-full max-w-xl min-w-0 lg:ml-0">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              name="q"
              aria-label="Search clients"
              placeholder="Search clients by name or phone"
              className="h-10 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm placeholder:text-ink-subtle focus:border-focus focus:ring-2 focus:ring-focus/25 focus:outline-none"
            />
          </form>
          <form action={logout} className="lg:hidden">
            <button type="submit" aria-label="Sign out" title="Sign out" className={buttonClass("ghost", "md", "", { square: true })}>
              <LogOutIcon className="size-5" />
            </button>
          </form>
        </header>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-b border-line px-4 py-2 lg:hidden">
          {NAV.filter((n) => shown(n, user.role)).map(({ section: s, href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={s === section ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${s === section ? "bg-navy-100 font-medium text-navy-900" : "text-ink-muted"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <main className="flex min-h-0 flex-1 flex-col lg:overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
