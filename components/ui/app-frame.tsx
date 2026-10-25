import Link from "next/link";
import { logout } from "@/app/login/actions";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { BoxIcon, CalendarIcon, RingIcon, ChartIcon, GiftIcon, ReceiptIcon, ClockIcon, ClipboardIcon, HomeIcon, LogOutIcon, ScissorsIcon, SearchIcon, SettingsIcon, TeamIcon, ShieldIcon, TagIcon, UserIcon, WalletIcon } from "@/components/ui/icons";
import { SalonMark } from "@/components/ui/salon-mark";
import { firstSettingsPage } from "@/app/settings/settings-nav";
import { AutoLock } from "@/components/auto-lock";
import { can, type Permission } from "@/lib/permissions";
import { isFrontOfHouse, roleLabel, type StaffRole } from "@/lib/staff";

export type Section = "account" | "dashboard" | "my-day" | "calendar" | "events" | "sales" | "gift-cards" | "reports" | "payroll" | "policy" | "promotions" | "clients" | "team" | "services" | "durations" | "inventory" | "forms" | "settings";

type NavItem = {
  section: Section;
  href: string;
  label: string;
  Icon: (p: { className?: string }) => React.ReactNode;
  // Who sees it: a permission (lib/permissions.ts), owners and managers,
  // their own book (stylists and assistants) or the front of house.
  needs?: Permission;
  managersOnly?: boolean;
  ownBook?: boolean;
  frontOfHouse?: boolean;
};

type User = { name: string; role: StaffRole; permissions: readonly string[] };

// The sidebar, in groups under small headings; Settings sits at the
// bottom. Items (and whole groups) a role can't use are hidden.
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Daily",
    items: [
      { section: "dashboard", href: "/dashboard", label: "Dashboard", Icon: HomeIcon },
      { section: "my-day", href: "/my-day", label: "My day", Icon: ClockIcon, ownBook: true },
      { section: "calendar", href: "/calendar", label: "Calendar", Icon: CalendarIcon },
      { section: "clients", href: "/clients", label: "Clients", Icon: UserIcon },
      { section: "events", href: "/events", label: "Events", Icon: RingIcon, frontOfHouse: true },
    ],
  },
  {
    label: "Sales",
    items: [
      { section: "sales", href: "/sales", label: "Sales", Icon: ReceiptIcon, frontOfHouse: true },
      { section: "gift-cards", href: "/gift-cards", label: "Gift cards", Icon: GiftIcon, frontOfHouse: true },
      { section: "promotions", href: "/promotions", label: "Promotions", Icon: TagIcon, frontOfHouse: true },
      { section: "reports", href: "/reports", label: "Reports", Icon: ChartIcon, needs: "reports" },
      { section: "payroll", href: "/payroll", label: "Payroll", Icon: WalletIcon, needs: "payroll" },
      { section: "policy", href: "/policy", label: "Policy", Icon: ShieldIcon, needs: "reports" },
    ],
  },
  {
    label: "Salon",
    items: [
      { section: "team", href: "/team", label: "Team", Icon: TeamIcon },
      { section: "services", href: "/services", label: "Services", Icon: ScissorsIcon },
      { section: "durations", href: "/durations", label: "Durations", Icon: ClockIcon, managersOnly: true },
      { section: "inventory", href: "/inventory", label: "Inventory", Icon: BoxIcon },
      { section: "forms", href: "/forms", label: "Forms", Icon: ClipboardIcon },
    ],
  },
];
// Settings opens on the first settings page they can use, if any.
function settingsFor(user: User): NavItem | null {
  const href = firstSettingsPage(user);
  return href ? { section: "settings", href, label: "Settings", Icon: SettingsIcon } : null;
}

function shown(item: NavItem, user: User): boolean {
  return (
    (!item.needs || can(user, item.needs)) &&
    (!item.managersOnly || user.role === "owner" || user.role === "manager") &&
    (!item.ownBook || user.role === "stylist" || user.role === "assistant") &&
    (!item.frontOfHouse || isFrontOfHouse(user.role))
  );
}

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  const { href, label, Icon } = item;
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-[background-color,color,transform] duration-(--motion-fast) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-focus ${
        current ? "bg-navy-100 text-navy-900" : "text-ink-muted hover:bg-surface hover:text-ink"
      }`}
    >
      <Icon className="size-5 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

// "Powered by Maestra", small, at the foot of the sidebar.
function PoweredBy() {
  return (
    <p className="flex items-center justify-center gap-1.5 text-xs whitespace-nowrap text-ink-subtle" data-testid="powered-by">
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
  sharedDevice = null,
  children,
}: {
  section: Section;
  businessName: string;
  logoUrl: string | null;
  locationName: string;
  user: User;
  // On the shared front-desk iPad: switch to someone else, and lock after
  // the salon's idle time.
  sharedDevice?: { autoLockMinutes: number } | null;
  children: React.ReactNode;
}) {
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => shown(n, user)) })).filter((g) => g.items.length > 0);
  const settings = settingsFor(user);
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
        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-3">
          {groups.map((g) => (
            <div key={g.label} role="group" aria-labelledby={`nav-${g.label}`} className="flex flex-col gap-0.5">
              <h2 id={`nav-${g.label}`} className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                {g.label}
              </h2>
              {g.items.map((item) => (
                <NavLink key={item.href} item={item} current={item.section === section} />
              ))}
            </div>
          ))}
          {settings && (
            <div className="mt-auto border-t border-line pt-3">
              <NavLink item={settings} current={section === "settings"} />
            </div>
          )}
        </nav>
        {/* The footer: who's signed in, sign out, and "Powered by Maestra",
            each on its own line, never under anything else. */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" data-testid="sidebar-footer">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={user.name} size="sm" halo={false} />
            <div className="min-w-0 flex-1">
              <Link href="/account" className="block truncate text-sm font-medium hover:underline" data-testid="sidebar-user">
                {user.name}
              </Link>
              <div className="truncate text-xs text-ink-muted">{roleLabel(user.role)}</div>
            </div>
            {!sharedDevice && (
              <form action={logout} className="shrink-0">
                <button type="submit" aria-label="Sign out" title="Sign out" className={buttonClass("ghost", "sm", "", { square: true })}>
                  <LogOutIcon className="size-4" />
                </button>
              </form>
            )}
          </div>
          {sharedDevice && (
            <form action="/switch/lock" method="post">
              <button type="submit" className={buttonClass("secondary", "sm", "w-full")}>
                Switch user
              </button>
            </form>
          )}
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
          {sharedDevice ? (
            <form action="/switch/lock" method="post" className="lg:hidden">
              <button type="submit" className={buttonClass("secondary", "sm")}>
                Switch user
              </button>
            </form>
          ) : (
            <form action={logout} className="lg:hidden">
              <button type="submit" aria-label="Sign out" title="Sign out" className={buttonClass("ghost", "md", "", { square: true })}>
                <LogOutIcon className="size-5" />
              </button>
            </form>
          )}
        </header>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-b border-line px-4 py-2 lg:hidden">
          {[...groups.flatMap((g) => g.items), ...(settings ? [settings] : [])].map(({ section: s, href, label }) => (
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
      {sharedDevice && <AutoLock minutes={sharedDevice.autoLockMinutes} />}
    </div>
  );
}
