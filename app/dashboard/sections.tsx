import { isFrontOfHouse } from "@/lib/staff";
import Link from "next/link";
import { ClientInsightCard } from "@/components/client-insight";
import { DeniseFace, DenisePose } from "@/components/denise";
import { buttonClass } from "@/components/ui/button";
import { ChevronRightIcon } from "@/components/ui/icons";
import type { DashboardData, MyDay, Opportunities } from "@/lib/dashboard-load";
import { formatMinute } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { EmptyState, Section } from "@/components/ui/page";
import { StatusChip } from "@/components/ui/status-chip";
import { AllClear } from "./all-clear";

const cardClass = "rounded-lg border border-line bg-surface";
const seeAllClass = "inline-flex items-center gap-0.5 text-sm font-medium text-link hover:text-link-hover hover:underline";

// "+3 vs last Thu", "Same as last Thu".
function change(c: { change: number }, unit: (n: number) => string, lastWeek: string): string {
  if (c.change === 0) return `Same as ${lastWeek}`;
  return `${c.change > 0 ? "▲" : "▼"} ${unit(Math.abs(c.change))} vs ${lastWeek}`;
}

// A flat strip of numbers: one border, cells divided by thin lines. The
// cells grow to fill each row, so there are never empty slots when they wrap.
export function StatStrip({ label, className = "", children, ...rest }: { label?: string; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <dl aria-label={label} className={`flex flex-wrap gap-px overflow-hidden rounded-lg border border-line bg-line ${className}`} {...rest}>
      {children}
    </dl>
  );
}

const cellClass = "flex min-w-0 flex-1 basis-40 flex-col gap-1 bg-surface px-4 py-3";

// One number in a strip: label (13px muted), value (24px), note (12px).
export function StatCell({ label, value, note, href, testId, valueTestId }: { label: string; value: string; note?: string; href?: string; testId?: string; valueTestId?: string }) {
  const body = (
    <>
      <dt className="text-13 text-ink-muted">{label}</dt>
      <dd className="text-2xl font-semibold text-ink tabular-nums" data-testid={valueTestId}>
        {value}
      </dd>
      {note && <dd className="text-xs text-ink-subtle tabular-nums">{note}</dd>}
    </>
  );
  return href ? (
    <Link href={href} data-testid={testId} className={`${cellClass} animate-fade-in transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none`}>
      {body}
    </Link>
  ) : (
    <div data-testid={testId} className={`${cellClass} animate-fade-in`}>
      {body}
    </div>
  );
}

// Today at a glance: a cell each, compared with the same day last week.
export function Glance({ data, lastWeek }: { data: DashboardData; lastWeek: string }) {
  const t = data.tiles;
  const count = (n: number) => String(n);
  const points = (n: number) => `${n} pts`;
  const fullnessChange = t.fullness.now !== null && t.fullness.then !== null ? { change: t.fullness.now - t.fullness.then } : null;
  const missed = t.missed.noShows + t.missed.canceled;
  const thenMissed = t.missed.thenNoShows + t.missed.thenCanceled;
  const mine = !isFrontOfHouse(data.role);
  return (
    <Section title={mine ? "Your day at a glance" : "Today at a glance"} titleId="glance-heading">
      <StatStrip>
        <StatCell testId="tile-appointments" label="Appointments" value={count(t.appointments.now)} note={change(t.appointments, count, lastWeek)} href="/calendar" />
        <StatCell
          testId="tile-fullness"
          label="Book filled"
          value={t.fullness.now === null ? "–" : `${t.fullness.now}%`}
          note={fullnessChange ? change(fullnessChange, points, lastWeek) : "No hours set"}
          href="/calendar"
        />
        {t.revenueCents && (
          <StatCell testId="tile-revenue" label="Expected revenue" value={formatPrice(t.revenueCents.now)} note={change(t.revenueCents, formatPrice, lastWeek)} href="/calendar" />
        )}
        <StatCell testId="tile-checked-in" label="Checked in so far" value={count(t.checkedIn.now)} note={change(t.checkedIn, count, `${lastWeek} by now`)} href="/calendar" />
        <StatCell
          testId="tile-missed"
          label="No-shows · canceled"
          value={`${t.missed.noShows} · ${t.missed.canceled}`}
          note={change({ change: missed - thenMissed }, count, lastWeek)}
          href="/calendar"
        />
      </StatStrip>
    </Section>
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

function OpportunityCard({ title, action, children, testId }: { title: string; action?: React.ReactNode; children: React.ReactNode; testId: string }) {
  return (
    <section aria-label={title} data-testid={testId} className={`${cardClass} flex min-w-0 flex-1 basis-72 animate-fade-in flex-col`}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {action}
      </div>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

// Overdue regulars, gaps worth filling, and stock upcoming services need:
// a card for each with something in it, and one "All clear" row for the rest.
export function OpportunitySections({ o, today, mine }: { o: Opportunities; today: string; mine: boolean }) {
  const rowLink = "block px-4 py-3 transition-colors duration-(--motion-fast) hover:bg-sunken";
  const cards: { testId: string; title: string; why: string; card: React.ReactNode | null }[] = [
    {
      testId: "opportunity-overdue",
      title: mine ? "Your regulars due back" : "Regulars due back",
      why: "Everyone's booked in or not due yet.",
      card: o.overdue.length ? (
        <OpportunityCard
          key="overdue"
          testId="opportunity-overdue"
          title={mine ? "Your regulars due back" : "Regulars due back"}
          action={o.overdueTotal > 0 && <SeeAll href="/clients?due=1" label={`See all ${o.overdueTotal} regulars due back`} />}
        >
          {o.overdue.map((c) => (
            <li key={c.clientId}>
              <Link href={`/clients/${c.clientId}`} className={`${rowLink} group`}>
                <span className="block text-sm font-medium text-ink underline-offset-2 group-hover:underline">{c.name}</span>
                <span className="block text-13 text-ink-muted">{c.reason}</span>
              </Link>
            </li>
          ))}
        </OpportunityCard>
      ) : null,
    },
  ];
  if (!mine) {
    cards.push(
      {
        testId: "opportunity-gaps",
        title: "Open time to fill",
        why: "No gaps of an hour or more today or tomorrow.",
        card: o.gaps.length ? (
          <OpportunityCard key="gaps" testId="opportunity-gaps" title="Open time to fill" action={<SeeAll href="/calendar" label="See all open time on the calendar" />}>
            {o.gaps.map((g) => (
              <li key={`${g.staffId}-${g.date}-${g.start}`}>
                <Link href={`/calendar?${g.date === today ? "" : `date=${g.date}&`}staff=${g.staffId}`} className={`${rowLink} group`}>
                  <span className="block text-sm font-medium text-ink underline-offset-2 group-hover:underline">
                    {g.staffName}, {g.date === today ? "today" : "tomorrow"} {formatMinute(g.start)}–{formatMinute(g.end)}
                  </span>
                  <span className="block text-13 text-ink-muted">{g.matches.length ? `Waitlist: ${g.matches.join(", ")}` : `${Math.round((g.end - g.start) / 15) * 15} min free`}</span>
                </Link>
              </li>
            ))}
          </OpportunityCard>
        ) : null,
      },
      {
        testId: "opportunity-stock",
        title: "Stock for upcoming services",
        why: "Nothing's running low for the next two weeks.",
        card: o.lowStock.length ? (
          <OpportunityCard key="stock" testId="opportunity-stock" title="Stock for upcoming services" action={<SeeAll href="/inventory?low=1" label="See all low stock" />}>
            {o.lowStock.map((p) => (
              <li key={p.product} className="px-4 py-3">
                <span className="block text-sm font-medium text-ink">{p.product}</span>
                <span className="block text-13 text-ink-muted">{p.reason}</span>
              </li>
            ))}
          </OpportunityCard>
        ) : null,
      },
    );
  }
  const shown = cards.filter((c) => c.card);
  const clear = cards.filter((c) => !c.card);
  return (
    <Section title="Opportunities" titleId="opportunities-heading">
      {shown.length > 0 && <div className={`flex flex-wrap gap-3 ${clear.length ? "mb-3" : ""}`}>{shown.map((c) => c.card)}</div>}
      <AllClear items={clear.map((c) => ({ title: c.title, why: c.why, testId: c.testId }))} />
    </Section>
  );
}

// How full each day of this week is, and (owners and managers) sales so
// far against the same days last week.
export function ThisWeek({ week, mine }: { week: DashboardData["week"]; mine: boolean }) {
  const top = Math.max(100, ...week.days.map((d) => d.percent ?? 0));
  const sales = week.sales;
  return (
    <Section title="This week" titleId="week-heading">
      {sales && (
        <StatStrip className="mb-3" data-testid="week-sales">
          <StatCell label={`Sales this week (Mon–${sales.through})`} value={formatPrice(Math.round(sales.thisWeek * 100))} note={`${formatPrice(Math.round(sales.lastWeek * 100))} the same days last week`} />
          {sales.lastWeek > 0 && (
            <StatCell
              label="Against last week"
              value={`${sales.thisWeek >= sales.lastWeek ? "▲" : "▼"} ${Math.abs(Math.round(((sales.thisWeek - sales.lastWeek) / sales.lastWeek) * 100))}%`}
              note={`Mon–${sales.through}, both weeks`}
            />
          )}
        </StatStrip>
      )}
      <figure className={`${cardClass} animate-fade-in p-4`} data-testid="week-chart">
        <figcaption className="mb-3 text-13 text-ink-muted">{mine ? "How full your book is" : "How full the book is"}, each day</figcaption>
        <ol className="flex h-36 items-end gap-2 sm:gap-3" aria-label="Book filled each day">
          {week.days.map((d, i) => (
            <li key={d.date} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${d.label}: ${d.percent === null ? "closed" : `${d.percent}% booked`}`}>
              <span className={`text-xs tabular-nums ${d.today ? "font-semibold text-ink" : "text-ink-muted"}`}>{d.percent === null ? "–" : `${d.percent}%`}</span>
              <span className="flex w-full max-w-10 flex-1 items-end">
                <span
                  className={`block w-full origin-bottom animate-grow-up rounded-t-[4px] ${d.today ? "bg-navy-900" : "bg-navy-700/75"} transition-[filter] duration-(--motion-fast) group-hover:brightness-110`}
                  style={{ height: `${((d.percent ?? 0) / top) * 100}%`, animationDelay: `${i * 40}ms` }}
                />
              </span>
              <span className={`text-xs ${d.today ? "font-semibold text-ink" : "text-ink-muted"}`}>{d.today ? "Today" : d.label}</span>
            </li>
          ))}
        </ol>
      </figure>
    </Section>
  );
}

// A stylist's own day: Denise's notes for them, their next client with
// what she knows about them, their visits and their stats.
export function MyDaySections({ me }: { me: MyDay }) {
  return (
    <>
      <section aria-labelledby="my-notes-heading" data-testid="my-denise-notes" className="mb-8 flex animate-fade-in items-start gap-4 rounded-lg border border-denise-200 bg-denise-50 p-4 sm:p-6">
        <DenisePose pose={me.notes.length ? "point" : "wave"} className="w-12 shrink-0 sm:w-14" />
        <div className="min-w-0 flex-1">
          <h2 id="my-notes-heading" className="text-base font-semibold text-denise-900">
            Denise&rsquo;s notes for you
          </h2>
          {me.notes.length ? (
            <ul className="mt-2 flex flex-col gap-2 text-sm text-ink">
              {me.notes.map((n) => (
                <li key={n} className="flex gap-2">
                  <DeniseFace size={20} className="mt-px" />
                  {n}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">All clear today. Nothing on your day looks like it will run over.</p>
          )}
        </div>
      </section>

      <div className="mb-8 grid gap-3 lg:grid-cols-[3fr_2fr] lg:items-start">
        <section aria-labelledby="next-client-heading" className={`${cardClass} animate-fade-in p-4`} data-testid="my-next-client">
          <h2 id="next-client-heading" className="text-13 text-ink-muted">
            {me.next?.status === "checked_in" ? "In your chair" : "Your next client"}
          </h2>
          {me.next ? (
            <>
              <p className="mt-1 text-xl font-semibold text-ink">
                {me.next.client} · <span className="tabular-nums">{formatMinute(me.next.start)}</span>
              </p>
              <p className="text-sm text-ink-muted">{me.next.service}</p>
              {me.next.insight && (
                <div className="mt-3 border-t border-line pt-3">
                  <ClientInsightCard insight={me.next.insight} plain />
                </div>
              )}
              <Link href={`/calendar?open=${me.next.appointmentId}`} className={buttonClass("secondary", "sm", "mt-4")}>
                Open booking
              </Link>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">No one else on your book today.</p>
          )}
        </section>
        <section aria-labelledby="my-stats-heading" className={`${cardClass} flex animate-fade-in flex-col overflow-hidden`} data-testid="my-stats">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 id="my-stats-heading" className="text-sm font-semibold text-ink">
              Your numbers
            </h2>
            <Link href="/my-day" className={seeAllClass}>
              Open My day
              <ChevronRightIcon className="size-4" />
            </Link>
          </div>
          <dl className="grid flex-1 grid-cols-2 gap-px bg-line">
            <Stat label="Still to come" value={String(me.stats.toCome)} />
            <Stat label="Done so far" value={String(me.stats.done)} />
            <Stat label="Book filled" value={me.stats.percent === null ? "–" : `${me.stats.percent}%`} />
            <Stat
              label="Rebook before leaving"
              value={me.stats.rebookedPercent === null ? "–" : `${me.stats.rebookedPercent}%`}
              note={me.stats.salonRebookedPercent !== null ? `Salon ${me.stats.salonRebookedPercent}%` : undefined}
            />
          </dl>
        </section>
      </div>

      <Section title="Your day" titleId="my-visits-heading" count={me.visits.length || undefined} data-testid="my-visits">
        {me.visits.length ? (
          <ul className={`${cardClass} animate-fade-in divide-y divide-line overflow-hidden`}>
            {me.visits.map((v) => (
              <li key={v.itemId}>
                <Link href={`/calendar?open=${v.appointmentId}`} className="group flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-(--motion-fast) hover:bg-sunken">
                  <span className="w-16 text-sm font-medium text-ink tabular-nums">{formatMinute(v.start)}</span>
                  <span className="min-w-32 flex-1 text-sm">
                    <span className="font-medium text-ink underline-offset-2 group-hover:underline">{v.client}</span> <span className="text-ink-muted">· {v.service}</span>
                  </span>
                  <StatusChip status={v.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className={cardClass}>
            <EmptyState>Nothing on your book today.</EmptyState>
          </div>
        )}
      </Section>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-4 py-3">
      <dt className="text-13 text-ink-muted">{label}</dt>
      <dd className="text-2xl font-semibold text-ink tabular-nums">{value}</dd>
      {note && <dd className="text-xs text-ink-subtle tabular-nums">{note}</dd>}
    </div>
  );
}

// A brand-new salon: what to set up first.
export function Welcome({ owner }: { owner: boolean }) {
  return (
    <section aria-labelledby="welcome-heading" data-testid="dashboard-welcome" className="mb-8 flex animate-fade-in items-start gap-4 rounded-lg border border-denise-200 bg-denise-50 p-4 sm:p-6">
      <DenisePose pose="wave" className="w-14 shrink-0 sm:w-16" />
      <div>
        <h2 id="welcome-heading" className="text-xl font-semibold text-denise-900">
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
