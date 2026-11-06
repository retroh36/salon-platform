import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { getCurrentStaff } from "@/lib/auth";
import { fullnessTone, monthDays, monthLabel, monthWeeks, parseMonth, shiftMonth, type MonthEvent } from "@/lib/calendar-month";
import { isFrontOfHouse } from "@/lib/staff";
import { loadBookingContext, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, todayIn, toLocal, type LocalDate } from "@/lib/scheduling/time";

export const metadata: Metadata = { title: "Calendar · Month" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function MonthPage({ searchParams }: PageProps<"/calendar/month">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Month searchParams={searchParams} />
    </Suspense>
  );
}

// The month at a glance: each day's visits, how full the stylists are,
// who's off and events; a day opens it on the calendar. Stylists and
// assistants see their own book (RLS keeps the visits to it too).
async function Month({ searchParams }: Pick<PageProps<"/calendar/month">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const month = parseMonth(typeof params.month === "string" ? params.month : undefined, today);
  const weeks = monthWeeks(month);
  const from = weeks[0][0];
  const to = weeks.at(-1)![6];

  const [ctx, visits, events] = await Promise.all([
    loadBookingContext(supabase, me.location, from, to),
    supabase
      .from("appointments")
      .select("starts_at")
      .eq("location_id", me.location.id)
      .not("status", "in", "(canceled,no_show)")
      .gte("starts_at", startOfLocalDay(from, tz).toISOString())
      .lt("starts_at", startOfLocalDay(addDays(to, 1), tz).toISOString()),
    supabase
      .from("events")
      .select("id, title, event_date")
      .eq("location_id", me.location.id)
      .in("status", ["booked", "trial_done", "completed"])
      .gte("event_date", from)
      .lte("event_date", to)
      .order("event_date"),
  ]);
  if (visits.error) throw visits.error;
  if (events.error) throw events.error;

  const visitsByDay = new Map<LocalDate, number>();
  for (const v of visits.data) {
    const d = toLocal(new Date(v.starts_at), tz).date;
    visitsByDay.set(d, (visitsByDay.get(d) ?? 0) + 1);
  }
  const book = me.assists_staff_id ?? me.id;
  const stylistIds = isFrontOfHouse(me.role) ? [...ctx.staff.values()].filter((s) => s.isActive && s.serviceIds.size > 0).map((s) => s.id) : [book];
  const monthEvents: MonthEvent[] = events.data.map((e) => ({ id: e.id, date: e.event_date, label: e.title }));
  const grid = monthDays(month, ctx, stylistIds, visitsByDay, monthEvents);
  const monthLink = (m: string) => `/calendar/month?month=${m}`;
  const dayName = (d: LocalDate) => `${SHORT_MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;

  return (
    <AppShell section="calendar" me={me}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Month" className="inline-flex items-stretch divide-x divide-line overflow-hidden rounded-md border border-line bg-surface">
          <Link href={monthLink(shiftMonth(month, -1))} className="touch-target inline-flex h-9 items-center px-3 text-sm font-medium text-ink hover:bg-sunken" aria-label="Previous month">
            ←
          </Link>
          <Link href={monthLink(today.slice(0, 7))} className="touch-target inline-flex h-9 items-center px-3 text-sm font-medium text-ink hover:bg-sunken">
            This month
          </Link>
          <Link href={monthLink(shiftMonth(month, 1))} className="touch-target inline-flex h-9 items-center px-3 text-sm font-medium text-ink hover:bg-sunken" aria-label="Next month">
            →
          </Link>
        </nav>
        <h1 className="text-xl font-semibold text-ink">{monthLabel(month)}</h1>
        <div className="ml-auto inline-flex h-9 items-center rounded-md border border-line bg-surface p-0.5" aria-label="View">
          <Link href={`/calendar?date=${month === today.slice(0, 7) ? today : `${month}-01`}`} className="inline-flex h-full items-center rounded px-3 text-sm font-medium text-ink-muted hover:text-ink">
            Day
          </Link>
          <span aria-current="page" className="inline-flex h-full items-center rounded bg-active-soft px-3 text-sm font-medium text-active-ink">
            Month
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface" data-testid="month-grid">
        <div className="grid grid-cols-7 border-b border-line bg-sunken max-md:hidden" aria-hidden>
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-1.5 text-xs font-medium text-ink-muted">
              {w}
            </div>
          ))}
        </div>
        <ol className="grid grid-cols-1 md:grid-cols-7">
          {grid.flat().map((d) => {
            const tone = fullnessTone(d.percent);
            const isToday = d.date === today;
            return (
              <li key={d.date} className={`border-line md:min-h-28 md:border-r md:border-b md:[&:nth-child(7n)]:border-r-0 max-md:border-b ${d.inMonth ? "" : "max-md:hidden md:bg-canvas"}`}>
                <Link
                  href={`/calendar?date=${d.date}`}
                  data-date={d.date}
                  data-fullness={tone ?? undefined}
                  aria-label={`${dayName(d.date)}${d.closed ? ", closed" : `, ${d.visits} ${d.visits === 1 ? "visit" : "visits"}`}`}
                  className="flex h-full flex-col gap-1 px-2 py-1.5 transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus max-md:flex-row max-md:items-center max-md:gap-3 max-md:py-2.5"
                >
                  <span className={`text-13 tabular-nums ${isToday ? "inline-flex size-6 items-center justify-center rounded-full bg-active font-semibold text-white" : d.inMonth ? "font-medium text-ink" : "text-ink-subtle"}`}>
                    <span className="md:hidden">{WEEKDAYS[(new Date(`${d.date}T12:00:00Z`).getUTCDay() + 6) % 7]} </span>
                    {Number(d.date.slice(8))}
                  </span>
                  {d.closed ? (
                    <span className="text-xs text-ink-subtle">Closed</span>
                  ) : (
                    <span className={`flex flex-col gap-1 max-md:flex-1 max-md:flex-row max-md:items-center max-md:gap-3 ${d.inMonth ? "" : "opacity-60"}`}>
                      <span className="text-xs text-ink" data-testid="month-visits">
                        {d.visits === 0 ? "No visits" : `${d.visits} ${d.visits === 1 ? "visit" : "visits"}`}
                      </span>
                      {d.percent !== null && (
                        <span className="flex items-center gap-1.5 max-md:w-28" title={`${d.percent}% of working time booked`}>
                          <span className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
                            <span className="block h-full rounded-full bg-navy-700" style={{ width: `${Math.min(100, d.percent)}%` }} />
                          </span>
                          <span className="text-2xs text-ink-muted tabular-nums">{d.percent}%</span>
                        </span>
                      )}
                      {d.off > 0 && <span className="text-2xs text-ink-muted">{d.off} off</span>}
                      {d.events.map((e) => (
                        <span key={e.id} className="truncate rounded bg-sunken px-1.5 py-0.5 text-2xs text-ink" title={e.label}>
                          {e.label}
                        </span>
                      ))}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-3 text-13 text-ink-muted">
        Tap a day to open it. The bar is how much of the {isFrontOfHouse(me.role) ? "stylists'" : "your"} working time is booked.
      </p>
    </AppShell>
  );
}
