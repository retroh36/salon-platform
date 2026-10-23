import Link from "next/link";
import { ClientInsightCard } from "@/components/client-insight";
import { STATUS_LABELS } from "@/lib/appointments";
import { DeniseFace, DenisePose } from "@/components/denise";
import { buttonClass } from "@/components/ui/button";
import { ChevronRightIcon } from "@/components/ui/icons";
import type { DashboardData, MyDay, Opportunities } from "@/lib/dashboard-load";
import { formatMinute } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";

const cardClass = "rounded-xl border border-line bg-surface shadow-card";
const headingClass = "font-serif text-lg font-semibold text-ink";
const seeAllClass = "inline-flex items-center gap-0.5 text-sm font-medium text-link hover:text-link-hover hover:underline";

// "+3 vs last Thu", "Same as last Thu".
function change(c: { change: number }, unit: (n: number) => string, lastWeek: string): string {
  if (c.change === 0) return `Same as ${lastWeek}`;
  return `${c.change > 0 ? "▲" : "▼"} ${unit(Math.abs(c.change))} vs ${lastWeek}`;
}

function Tile({ label, value, sub, href, testId }: { label: string; value: string; sub: string; href: string; testId: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={`${cardClass} group flex animate-fade-in flex-col gap-1 p-4 transition-[box-shadow,transform,border-color] duration-(--motion-fast) hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift focus-visible:outline-2 focus-visible:outline-focus`}
    >
      <span className="text-sm font-medium text-ink-muted">{label}</span>
      <span className="font-serif text-3xl font-semibold text-navy-900 tabular-nums">{value}</span>
      <span className="text-xs text-ink-muted tabular-nums">{sub}</span>
    </Link>
  );
}

// Today at a glance: a tile each, compared with the same day last week.
export function Glance({ data, lastWeek }: { data: DashboardData; lastWeek: string }) {
  const t = data.tiles;
  const count = (n: number) => String(n);
  const points = (n: number) => `${n} pts`;
  const fullnessChange = t.fullness.now !== null && t.fullness.then !== null ? { change: t.fullness.now - t.fullness.then } : null;
  const missed = t.missed.noShows + t.missed.canceled;
  const thenMissed = t.missed.thenNoShows + t.missed.thenCanceled;
  const mine = data.role === "stylist";
  return (
    <section aria-labelledby="glance-heading" className="mb-6">
      <h2 id="glance-heading" className={`${headingClass} mb-3`}>
        {mine ? "Your day at a glance" : "Today at a glance"}
      </h2>
      <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${t.revenueCents ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
        <Tile testId="tile-appointments" label="Appointments" value={count(t.appointments.now)} sub={change(t.appointments, count, lastWeek)} href="/calendar" />
        <Tile
          testId="tile-fullness"
          label="Book filled"
          value={t.fullness.now === null ? "–" : `${t.fullness.now}%`}
          sub={fullnessChange ? change(fullnessChange, points, lastWeek) : "No hours set"}
          href="/calendar"
        />
        {t.revenueCents && (
          <Tile testId="tile-revenue" label="Expected revenue" value={formatPrice(t.revenueCents.now)} sub={change(t.revenueCents, formatPrice, lastWeek)} href="/calendar" />
        )}
        <Tile testId="tile-checked-in" label="Checked in so far" value={count(t.checkedIn.now)} sub={change(t.checkedIn, count, `${lastWeek} by now`)} href="/calendar" />
        <Tile
          testId="tile-missed"
          label="No-shows · canceled"
          value={`${t.missed.noShows} · ${t.missed.canceled}`}
          sub={change({ change: missed - thenMissed }, count, lastWeek)}
          href="/calendar"
        />
      </div>
    </section>
  );
}

function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={seeAllClass} aria-label={label}>
      See all
      <ChevronRightIcon className="size-4" />
    </Link>
  );
}

function OpportunityCard({ title, action, empty, children, testId }: { title: string; action?: React.ReactNode; empty: string | null; children?: React.ReactNode; testId: string }) {
  return (
    <section aria-label={title} data-testid={testId} className={`${cardClass} flex animate-fade-in flex-col`}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {empty ? <p className="px-4 py-5 text-sm text-ink-muted">{empty}</p> : <ul className="divide-y divide-line">{children}</ul>}
    </section>
  );
}

// Overdue regulars, gaps worth filling, and stock upcoming services need.
export function OpportunitySections({ o, today, mine }: { o: Opportunities; today: string; mine: boolean }) {
  return (
    <section aria-labelledby="opportunities-heading" className="mb-6">
      <h2 id="opportunities-heading" className={`${headingClass} mb-3`}>
        Opportunities
      </h2>
      <div className={`grid gap-3 ${mine ? "" : "lg:grid-cols-3"}`}>
        <OpportunityCard
          testId="opportunity-overdue"
          title={mine ? "Your regulars due back" : "Regulars due back"}
          action={o.overdueTotal > 0 && <SeeAll href="/clients?due=1" label={`See all ${o.overdueTotal} regulars due back`} />}
          empty={o.overdue.length ? null : "Everyone's booked in or not due yet."}
        >
          {o.overdue.map((c) => (
            <li key={c.clientId}>
              <Link href={`/clients/${c.clientId}`} className="block px-4 py-3 transition-colors duration-(--motion-fast) hover:bg-sunken">
                <span className="block text-sm font-semibold text-ink">{c.name}</span>
                <span className="block text-xs text-ink-muted">{c.reason}</span>
              </Link>
            </li>
          ))}
        </OpportunityCard>
        {!mine && (
          <OpportunityCard
            testId="opportunity-gaps"
            title="Open time to fill"
            action={<SeeAll href="/calendar" label="See all open time on the calendar" />}
            empty={o.gaps.length ? null : "No gaps of an hour or more today or tomorrow."}
          >
            {o.gaps.map((g) => (
              <li key={`${g.staffId}-${g.date}-${g.start}`}>
                <Link href={`/calendar?${g.date === today ? "" : `date=${g.date}&`}staff=${g.staffId}`} className="block px-4 py-3 transition-colors duration-(--motion-fast) hover:bg-sunken">
                  <span className="block text-sm font-semibold text-ink">
                    {g.staffName}, {g.date === today ? "today" : "tomorrow"} {formatMinute(g.start)}–{formatMinute(g.end)}
                  </span>
                  <span className="block text-xs text-ink-muted">{g.matches.length ? `Waitlist: ${g.matches.join(", ")}` : `${Math.round((g.end - g.start) / 15) * 15} min free`}</span>
                </Link>
              </li>
            ))}
          </OpportunityCard>
        )}
        {!mine && (
          <OpportunityCard
            testId="opportunity-stock"
            title="Stock for upcoming services"
            action={<SeeAll href="/inventory?low=1" label="See all low stock" />}
            empty={o.lowStock.length ? null : "Nothing's running low for the next two weeks."}
          >
            {o.lowStock.map((p) => (
              <li key={p.product} className="px-4 py-3">
                <span className="block text-sm font-semibold text-ink">{p.product}</span>
                <span className="block text-xs text-ink-muted">{p.reason}</span>
              </li>
            ))}
          </OpportunityCard>
        )}
      </div>
    </section>
  );
}

// How full each day of this week is, and (owners and managers) sales so
// far against the same days last week.
export function ThisWeek({ week, mine }: { week: DashboardData["week"]; mine: boolean }) {
  const top = Math.max(100, ...week.days.map((d) => d.percent ?? 0));
  return (
    <section aria-labelledby="week-heading" className="mb-6">
      <h2 id="week-heading" className={`${headingClass} mb-3`}>
        This week
      </h2>
      <div className={`grid gap-3 ${week.sales ? "md:grid-cols-[2fr_1fr]" : ""}`}>
        <figure className={`${cardClass} animate-fade-in p-4`} data-testid="week-chart">
          <figcaption className="mb-3 text-sm font-medium text-ink-muted">{mine ? "How full your book is" : "How full the book is"}, each day</figcaption>
          <ol className="flex h-36 items-end gap-2 sm:gap-3" aria-label="Book filled each day">
            {week.days.map((d, i) => (
              <li key={d.date} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${d.label}: ${d.percent === null ? "closed" : `${d.percent}% booked`}`}>
                <span className={`text-xs tabular-nums ${d.today ? "font-semibold text-navy-900" : "text-ink-muted"}`}>{d.percent === null ? "–" : `${d.percent}%`}</span>
                <span className="flex w-full max-w-10 flex-1 items-end">
                  <span
                    className={`block w-full origin-bottom animate-grow-up rounded-t-[4px] ${d.today ? "bg-navy-900" : "bg-navy-700/75"} transition-[filter] duration-(--motion-fast) group-hover:brightness-110`}
                    style={{ height: `${((d.percent ?? 0) / top) * 100}%`, animationDelay: `${i * 40}ms` }}
                  />
                </span>
                <span className={`text-xs ${d.today ? "font-semibold text-navy-900" : "text-ink-muted"}`}>{d.today ? "Today" : d.label}</span>
              </li>
            ))}
          </ol>
        </figure>
        {week.sales && (
          <div className={`${cardClass} flex animate-fade-in flex-col justify-center gap-1 p-4`} data-testid="week-sales">
            <span className="text-sm font-medium text-ink-muted">Sales this week (Mon–{week.sales.through})</span>
            <span className="font-serif text-3xl font-semibold text-navy-900 tabular-nums">{formatPrice(Math.round(week.sales.thisWeek * 100))}</span>
            <span className="text-xs text-ink-muted tabular-nums">
              {formatPrice(Math.round(week.sales.lastWeek * 100))} the same days last week
              {week.sales.lastWeek > 0 && ` · ${week.sales.thisWeek >= week.sales.lastWeek ? "▲" : "▼"} ${Math.abs(Math.round(((week.sales.thisWeek - week.sales.lastWeek) / week.sales.lastWeek) * 100))}%`}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

// A stylist's own day: Denise's notes for them, their next client with
// what she knows about them, their visits and their stats.
export function MyDaySections({ me }: { me: MyDay }) {
  return (
    <>
      <section aria-labelledby="my-notes-heading" data-testid="my-denise-notes" className="mb-6 flex animate-fade-in items-start gap-4 rounded-2xl border border-denise-200 bg-denise-50 p-5 shadow-card">
        <DenisePose pose={me.notes.length ? "point" : "wave"} className="w-16" />
        <div className="min-w-0 flex-1">
          <h2 id="my-notes-heading" className="font-serif text-lg font-semibold text-denise-900">
            Denise&rsquo;s notes for you
          </h2>
          {me.notes.length ? (
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink">
              {me.notes.map((n) => (
                <li key={n} className="flex gap-2">
                  <DeniseFace size={20} className="mt-0.5" />
                  {n}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-denise-900">All clear today. Nothing on your day looks like it will run over.</p>
          )}
        </div>
      </section>

      <div className="mb-6 grid gap-3 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="next-client-heading" className={`${cardClass} animate-fade-in p-5`} data-testid="my-next-client">
          <h2 id="next-client-heading" className="text-sm font-medium text-ink-muted">
            {me.next?.status === "checked_in" ? "In your chair" : "Your next client"}
          </h2>
          {me.next ? (
            <>
              <p className="mt-1 font-serif text-2xl font-semibold text-navy-900">
                {me.next.client} · {formatMinute(me.next.start)}
              </p>
              <p className="mb-3 text-sm text-ink-muted">{me.next.service}</p>
              {me.next.insight && <ClientInsightCard insight={me.next.insight} />}
              <Link href={`/calendar?open=${me.next.appointmentId}`} className={buttonClass("secondary", "sm", "mt-3")}>
                Open booking
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">No one else on your book today.</p>
          )}
        </section>
        <section aria-labelledby="my-stats-heading" className={`${cardClass} animate-fade-in p-5`} data-testid="my-stats">
          <h2 id="my-stats-heading" className="text-sm font-medium text-ink-muted">
            Your numbers
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
            <Stat label="Still to come" value={String(me.stats.toCome)} />
            <Stat label="Done so far" value={String(me.stats.done)} />
            <Stat label="Book filled" value={me.stats.percent === null ? "–" : `${me.stats.percent}%`} />
            <Stat
              label="Rebook before leaving"
              value={me.stats.rebookedPercent === null ? "–" : `${me.stats.rebookedPercent}%`}
              note={me.stats.salonRebookedPercent !== null ? `Salon ${me.stats.salonRebookedPercent}%` : undefined}
            />
          </dl>
          <Link href="/my-day" className={`${seeAllClass} mt-3`}>
            Open My day
            <ChevronRightIcon className="size-4" />
          </Link>
        </section>
      </div>

      <section aria-labelledby="my-visits-heading" className={`${cardClass} mb-6 animate-fade-in`} data-testid="my-visits">
        <h2 id="my-visits-heading" className="border-b border-line px-5 py-3.5 font-serif text-lg font-semibold text-ink">
          Your day
        </h2>
        {me.visits.length ? (
          <ul className="divide-y divide-line">
            {me.visits.map((v) => (
              <li key={v.itemId}>
                <Link href={`/calendar?open=${v.appointmentId}`} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-5 py-3 transition-colors duration-(--motion-fast) hover:bg-sunken">
                  <span className="w-20 text-sm font-semibold text-ink tabular-nums">{formatMinute(v.start)}</span>
                  <span className="min-w-32 flex-1 text-sm text-ink">
                    {v.client} <span className="text-ink-muted">· {v.service}</span>
                  </span>
                  <span className="text-xs text-ink-muted">{STATUS_LABELS[v.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-muted">Nothing on your book today.</p>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-serif text-2xl font-semibold text-navy-900 tabular-nums">
        {value}
        {note && <span className="ml-1.5 font-sans text-xs font-normal text-ink-muted">{note}</span>}
      </dd>
    </div>
  );
}

// A brand-new salon: what to set up first.
export function Welcome({ owner }: { owner: boolean }) {
  return (
    <section aria-labelledby="welcome-heading" data-testid="dashboard-welcome" className="mb-6 flex animate-fade-in items-start gap-4 rounded-2xl border border-denise-200 bg-denise-50 p-5 shadow-card">
      <DenisePose pose="wave" className="w-20" />
      <div>
        <h2 id="welcome-heading" className="font-serif text-xl font-semibold text-denise-900">
          Welcome to Maestra
        </h2>
        <p className="mt-1 text-sm text-ink">Add your services and your team, and I&rsquo;ll start watching the day for you.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/services" className={buttonClass("primary", "sm")}>
            Add services
          </Link>
          <Link href="/team" className={buttonClass("secondary", "sm")}>
            See the team
          </Link>
          {owner && (
            <Link href="/settings" className={buttonClass("secondary", "sm")}>
              Settings
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
