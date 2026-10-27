import Link from "next/link";
import { logout } from "@/app/login/actions";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { BoxIcon, CalendarIcon, RingIcon, ChartIcon, GiftIcon, ReceiptIcon, ClockIcon, ClipboardIcon, HomeIcon, LogOutIcon, ScissorsIcon, SearchIcon, SettingsIcon, TeamIcon, ShieldIcon, TagIcon, UserIcon, WalletIcon } from "@/components/ui/icons";
import { SalonMark } from "@/components/ui/salon-mark";
import { SalonSwitcher, type SwitcherLocation } from "@/components/salon-switcher";
import { firstSettingsPage } from "@/app/settings/settings-nav";
import { AutoLock } from "@/components/auto-lock";
import { DeniseBubble, type BubbleMe } from "@/components/denise-chat/bubble";
import { NewSaleLink } from "@/components/new-sale-link";
import { canTakePayments } from "@/lib/sales";
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

// A sidebar link: light gray on the navy; the current page in white on the
// bright blue's tint, with an accent bar on its left edge.
function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  const { href, label, Icon } = item;
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-[background-color,color,transform] duration-(--motion-fast) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-sidebar-focus ${
        current ? "bg-sidebar-active text-white" : "text-sidebar-text hover:bg-sidebar-hover hover:text-white"
      }`}
    >
      {current && <span aria-hidden data-testid="nav-accent" className="absolute top-1.5 bottom-1.5 -left-3 w-[3px] rounded-r-full bg-sidebar-accent" />}
      <Icon className="size-5 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

// The app layout (docs/design/): the navy sidebar (Maestra's logo, the
// salon as a card that opens its locations, then the navigation), and a
// client search bar on top of the Calendar and Clients. Staff screens carry
// Maestra's logo instead of "Powered by Maestra", which stays on pages
// clients see.
export function AppFrame({
  section,
  businessName,
  logoUrl,
  locationName,
  locationId = "",
  locations = [],
  user,
  sharedDevice = null,
  denise = null,
  children,
}: {
  section: Section;
  businessName: string;
  logoUrl: string | null;
  locationName: string;
  locationId?: string;
  // The salon's locations, for the card's menu (this one if not given).
  locations?: SwitcherLocation[];
  user: User;
  // On the shared front-desk iPad: switch to someone else, and lock after
  // the salon's idle time.
  sharedDevice?: { autoLockMinutes: number } | null;
  // Denise's bubble, for who's signed in (none: the page has her already).
  denise?: BubbleMe | null;
  children: React.ReactNode;
}) {
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => shown(n, user)) })).filter((g) => g.items.length > 0);
  const settings = settingsFor(user);
  const search = section === "calendar" || section === "clients";
  return (
    // One screen tall on large screens: the calendar and panels scroll inside.
    <div className="flex min-h-screen flex-1 bg-canvas text-ink lg:h-[calc(100vh-var(--demo-bar))] lg:min-h-0 lg:flex-none lg:overflow-hidden">
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-text lg:flex" data-testid="sidebar">
        <div className="px-5 pt-6 pb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/maestra/maestra-logo-white.png" alt="Maestra" data-testid="sidebar-logo" className="-ml-1.5 h-8 w-auto" />
        </div>
        <div className="px-3 pb-5">
          <SalonSwitcher
            businessName={businessName}
            logoUrl={logoUrl}
            currentId={locationId}
            locations={locations.length ? locations : [{ id: locationId, name: locationName, city: null, region: null }]}
            settingsHref={can(user, "settings") ? "/settings" : null}
          />
        </div>
        {/* Scrolls on short screens, so it never runs into the footer. */}
        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-3">
          {groups.map((g) => (
            <div key={g.label} role="group" aria-labelledby={`nav-${g.label}`} className="flex flex-col gap-0.5">
              <h2 id={`nav-${g.label}`} className="px-3 pb-1 text-[11px] font-medium tracking-wider text-sidebar-muted uppercase">
                {g.label}
              </h2>
              {g.items.map((item) => (
                <NavLink key={item.href} item={item} current={item.section === section} />
              ))}
            </div>
          ))}
          {settings && (
            <div className="mt-auto border-t border-sidebar-line pt-3">
              <NavLink item={settings} current={section === "settings"} />
            </div>
          )}
        </nav>
        {/* The footer: who's signed in and sign out (or Switch user on the
            shared iPad), never under anything else. */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-sidebar-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" data-testid="sidebar-footer">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={user.name} size="sm" halo={false} />
            <div className="min-w-0 flex-1">
              <Link
                href="/account"
                className="block truncate rounded-sm text-sm font-medium text-white hover:underline focus-visible:outline-2 focus-visible:outline-sidebar-focus"
                data-testid="sidebar-user"
              >
                {user.name}
              </Link>
              <div className="truncate text-xs text-sidebar-muted">{roleLabel(user.role)}</div>
            </div>
            {!sharedDevice && (
              <form action={logout} className="shrink-0">
                <button
                  type="submit"
                  aria-label="Sign out"
                  title="Sign out"
                  className="inline-flex size-8 items-center justify-center rounded-md text-sidebar-text transition-colors duration-(--motion-fast) hover:bg-sidebar-hover hover:text-white focus-visible:outline-2 focus-visible:outline-sidebar-focus"
                >
                  <LogOutIcon className="size-4" />
                </button>
              </form>
            )}
          </div>
          {sharedDevice && (
            <form action="/switch/lock" method="post">
              <button
                type="submit"
                className="h-9 w-full rounded-md border border-sidebar-line text-sm font-medium text-white transition-colors duration-(--motion-fast) hover:bg-sidebar-hover focus-visible:outline-2 focus-visible:outline-sidebar-focus"
              >
                Switch user
              </button>
            </form>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* The client search is on the Calendar and Clients only; elsewhere the
            bar is just the compact header on small screens. */}
        <header className={`flex items-center gap-3 border-b border-line bg-canvas px-4 py-2.5 sm:px-6 ${search ? "" : "justify-between lg:hidden"}`}>
          {/* Compact header for screens without the sidebar. */}
          <div className="flex items-center gap-2 lg:hidden">
            <SalonMark name={businessName} logoUrl={logoUrl} />
            <span className="font-semibold text-ink">{businessName}</span>
          </div>
          {search && (
          <form action="/clients" role="search" className="relative ml-auto w-full max-w-xl min-w-0 lg:ml-0">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              name="q"
              aria-label="Search clients"
              placeholder="Search clients by name or phone"
              className="h-9 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm placeholder:text-ink-subtle focus:border-focus focus:ring-2 focus:ring-focus/25 focus:outline-none"
            />
          </form>
          )}
          {!search && canTakePayments(user.role) && (
            <span className="ml-auto lg:hidden">
              <NewSaleLink />
            </span>
          )}
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
              className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${s === section ? "bg-active-soft font-medium text-active-ink" : "text-ink-muted"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <main className="flex min-h-0 flex-1 flex-col text-sm lg:overflow-y-auto">{children}</main>
      </div>
      {denise && <DeniseBubble me={denise} />}
      {sharedDevice && <AutoLock minutes={sharedDevice.autoLockMinutes} />}
    </div>
  );
}
