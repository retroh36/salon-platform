import Link from "next/link";
import { logout } from "@/app/login/actions";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { CalendarIcon, HomeIcon, LogOutIcon, ScissorsIcon, SearchIcon, TeamIcon, UserIcon } from "@/components/ui/icons";
import { roleLabel, type StaffRole } from "@/lib/staff";

export type Section = "dashboard" | "calendar" | "clients" | "schedule" | "services";

const NAV: { section: Section; href: string; label: string; Icon: (p: { className?: string }) => React.ReactNode }[] = [
  { section: "dashboard", href: "/dashboard", label: "Dashboard", Icon: HomeIcon },
  { section: "calendar", href: "/calendar", label: "Calendar", Icon: CalendarIcon },
  { section: "clients", href: "/clients", label: "Clients", Icon: UserIcon },
  { section: "schedule", href: "/schedule", label: "Team schedule", Icon: TeamIcon },
  { section: "services", href: "/services", label: "Services", Icon: ScissorsIcon },
];

// The salon's mark: its initial in a soft plum leaf, until salons can
// upload a logo.
function SalonMark({ name }: { name: string }) {
  return (
    <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-[14px_4px_14px_4px] bg-plum-900 font-serif text-xl text-white">
      {name.trim()[0]?.toUpperCase() ?? "S"}
    </span>
  );
}

// The redesigned app layout (docs/design/): sidebar with the salon and
// navigation, a search bar on top. Pages move to it one at a time; the rest
// still use AppShell.
export function AppFrame({
  section,
  businessName,
  locationName,
  user,
  children,
}: {
  section: Section;
  businessName: string;
  locationName: string;
  user: { name: string; role: StaffRole };
  children: React.ReactNode;
}) {
  return (
    // One screen tall on large screens: the calendar and panels scroll inside.
    <div className="flex min-h-screen flex-1 bg-canvas text-ink lg:h-screen lg:min-h-0 lg:flex-none lg:overflow-hidden">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-sunken/60 lg:flex">
        <div className="flex items-center gap-3 px-5 pt-6 pb-5">
          <SalonMark name={businessName} />
          <div className="min-w-0">
            <div className="font-serif text-lg leading-tight font-semibold text-plum-900">{businessName}</div>
            <div className="mt-0.5 text-sm leading-tight text-ink-muted">{locationName}</div>
          </div>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1 px-3">
          {NAV.map(({ section: s, href, label, Icon }) => {
            const current = s === section;
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? "page" : undefined}
                className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-[background-color,color,transform] duration-(--motion-fast) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-plum-700 ${
                  current ? "bg-plum-100 text-plum-900" : "text-ink-muted hover:bg-surface hover:text-ink"
                }`}
              >
                <Icon className="size-5" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-3 border-t border-line px-4 py-4">
          <Avatar name={user.name} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="text-xs text-ink-muted">{roleLabel(user.role)}</div>
          </div>
          <form action={logout}>
            <button type="submit" aria-label="Sign out" title="Sign out" className={buttonClass("ghost", "sm", "", { square: true })}>
              <LogOutIcon className="size-4" />
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-canvas px-4 py-3 sm:px-6">
          {/* Compact header for screens without the sidebar. */}
          <div className="flex items-center gap-2 lg:hidden">
            <SalonMark name={businessName} />
            <span className="font-serif font-semibold text-plum-900">{businessName}</span>
          </div>
          <form action="/clients" role="search" className="relative ml-auto w-full max-w-xl min-w-0 lg:ml-0">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              name="q"
              aria-label="Search clients"
              placeholder="Search clients by name or phone"
              className="h-10 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm placeholder:text-ink-subtle focus:border-plum-700 focus:ring-2 focus:ring-plum-200 focus:outline-none"
            />
          </form>
          <form action={logout} className="lg:hidden">
            <button type="submit" aria-label="Sign out" title="Sign out" className={buttonClass("ghost", "md", "", { square: true })}>
              <LogOutIcon className="size-5" />
            </button>
          </form>
        </header>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-b border-line px-4 py-2 lg:hidden">
          {NAV.map(({ section: s, href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={s === section ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${s === section ? "bg-plum-100 font-medium text-plum-900" : "text-ink-muted"}`}
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
