import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@/lib/permissions";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Avatar, initials } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { ClockIcon } from "@/components/ui/icons";
import { Badge, listClass, PageHeader, pillClass, rowClass, type Tone } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { staffPhotoUrl } from "@/lib/branding";
import { isUuid } from "@/lib/ids";
import { describeTimeOff, formatDay, formatIntervals, STATUS_LABELS } from "@/lib/schedule-format";
import { LEVEL_LABELS, WEEKDAY_NAMES } from "@/lib/schedule-forms";
import { dayView, type TimeOff } from "@/lib/scheduling/availability";
import { loadLocationSchedule, loadStaffSchedules } from "@/lib/scheduling/load";
import { addDays, datesBetween, isLocalDate, minuteToTime, startOfWeek, todayIn, WEEKDAYS } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { fullName, roleLabel, sortStaff } from "@/lib/staff";
import { decideTimeOff, deleteTimeOff, removeDayChange, saveWeeklyHours } from "./actions";
import { CompensationForm } from "./compensation-form";
import { DayChangeForm } from "./day-change-form";
import { HoursEditor, type HoursRows } from "./hours-editor";
import { StaffPhotoForm } from "./staff-photo";
import { TeamTabs } from "../team/team-tabs";
import { TimeOffForm } from "./time-off-form";


export const metadata: Metadata = { title: "Schedule" };

export default function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Schedule searchParams={searchParams} />
    </Suspense>
  );
}

// Cards with h3 titles (Card from components/ui/page.tsx uses h2, and the
// staff member's name is this page's h2).
const cardClass = "mb-6 overflow-hidden rounded-xl border border-line bg-surface shadow-card";
const cardHeadClass = "border-b border-line px-5 py-3.5";
const cardTitleClass = "font-serif text-lg font-semibold text-ink";

async function Schedule({ searchParams }: Pick<PageProps<"/schedule">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;

  const manager = canManage(me.role);
  // Owners, managers and front desk see everyone's schedule; stylists see their own.
  const seesEveryone = manager || me.role === "front_desk";
  const today = todayIn(me.location.timezone);
  const week = typeof params.week === "string" && isLocalDate(params.week) ? startOfWeek(params.week) : startOfWeek(today);
  const weekEnd = addDays(week, 6);

  const { data: allStaff, error: staffError } = await supabase
    .from("staff")
    .select("id, first_name, last_name, role, level, color, photo_path, is_active, location_id");
  if (staffError) throw staffError;
  const team = sortStaff(allStaff.filter((s) => s.is_active && s.location_id === me.location.id));

  const requested = typeof params.staff === "string" && isUuid(params.staff) ? params.staff : me.id;
  const target = (seesEveryone ? team.find((s) => s.id === requested) : null) ?? team.find((s) => s.id === me.id)!;
  const isSelf = target.id === me.id;

  const historyFrom = addDays(today, -60);
  const [location, schedules, history, upcomingChanges, compensation, pending] = await Promise.all([
    loadLocationSchedule(supabase, me.location),
    loadStaffSchedules(supabase, [target.id], week, weekEnd),
    loadStaffSchedules(supabase, [target.id], historyFrom, addDays(today, 366)),
    supabase
      .from("staff_schedule_overrides")
      .select("on_date, start_minute, end_minute")
      .eq("staff_id", target.id)
      .gte("on_date", today)
      .order("on_date")
      .order("start_minute"),
    supabase
      .from("staff_compensation")
      .select("service_commission_pct, retail_commission_pct, hourly_rate_cents, plan_id")
      .eq("staff_id", target.id)
      .maybeSingle(),
    manager
      ? supabase
          .from("staff_time_off")
          .select("id, staff_id, starts_on, ends_on, start_minute, end_minute, reason, note, status")
          .eq("status", "requested")
          .gte("ends_on", today)
          .order("starts_on")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (upcomingChanges.error) throw upcomingChanges.error;
  if (compensation.error) throw compensation.error;
  if (pending.error) throw pending.error;

  const schedule = schedules.get(target.id)!;
  const days = datesBetween(week, weekEnd).map((date) => dayView(schedule, location, date));
  const timeOff = history.get(target.id)!.timeOff.sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  const staffName = new Map(allStaff.map((s) => [s.id, fullName(s)]));

  const weekly = schedule.weekly;
  const hoursRows: HoursRows = Object.fromEntries(
    WEEKDAYS.map((d) => [d, (weekly[d] ?? []).map((i) => ({ start: minuteToTime(i.start), end: minuteToTime(i.end) }))]),
  );

  const changes = new Map<string, { start: number; end: number }[]>();
  for (const c of upcomingChanges.data) {
    changes.set(c.on_date, [...(changes.get(c.on_date) ?? []), { start: c.start_minute, end: c.end_minute }]);
  }

  const link = (q: { staff?: string; week?: string }) => {
    const search = new URLSearchParams();
    if (seesEveryone && (q.staff ?? target.id) !== me.id) search.set("staff", q.staff ?? target.id);
    if ((q.week ?? week) !== startOfWeek(today)) search.set("week", q.week ?? week);
    const s = search.toString();
    return s ? `/schedule?${s}` : "/schedule";
  };

  return (
    <AppShell section="team" me={me}>
      <PageHeader
        title="Team"
        description="Working hours, one-off changes and time off."
        actions={
          <Link href="/schedule/opening-hours" className={buttonClass("secondary", "md")}>
            <ClockIcon className="size-4" />
            Opening hours
          </Link>
        }
      />
      <TeamTabs current="schedule" goals={manager} />

      {manager && pending.data.length > 0 && (
        <section aria-labelledby="requests-heading" className={`${cardClass} border-status-late-ink/30`}>
          <h2 id="requests-heading" className={`${cardHeadClass} bg-status-late-bg font-serif text-lg font-semibold text-status-late-ink`}>
            Time off requests ({pending.data.length})
          </h2>
          <ul className={listClass}>
            {pending.data.map((r) => (
              <li key={r.id} className={`${rowClass} flex flex-wrap items-center gap-x-4 gap-y-2 hover:bg-sunken/60`}>
                <span className="flex min-w-40 items-center gap-2 font-medium">
                  <Avatar name={staffName.get(r.staff_id) ?? "?"} size="sm" />
                  {staffName.get(r.staff_id)}
                </span>
                <span className="flex-1 text-sm">
                  {describeTimeOff({ startsOn: r.starts_on, endsOn: r.ends_on, startMinute: r.start_minute, endMinute: r.end_minute, status: r.status, reason: r.reason })}
                  {r.note && <span className="text-ink-muted"> · {r.note}</span>}
                </span>
                <form action={decideTimeOff.bind(null, r.id, "approved")}>
                  <button type="submit" className={buttonClass("primary", "sm")}>
                    Approve
                  </button>
                </form>
                <form action={decideTimeOff.bind(null, r.id, "declined")}>
                  <button type="submit" className={buttonClass("secondary", "sm")}>
                    Decline
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {seesEveryone && (
        <nav aria-label="Team" className="mb-6 flex flex-wrap gap-2">
          {team.map((s) => (
            <Link key={s.id} href={link({ staff: s.id })} aria-current={s.id === target.id ? "page" : undefined} className={`${pillClass(s.id === target.id)} gap-2 pl-1`}>
              <span
                aria-hidden
                className={`inline-flex size-6 items-center justify-center rounded-full text-[10px] font-semibold ${s.id === target.id ? "bg-white/20 text-white" : "bg-navy-100 text-navy-900"}`}
              >
                {initials(fullName(s))}
              </span>
              {s.first_name}
            </Link>
          ))}
        </nav>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Avatar name={fullName(target)} color={target.color} level={target.level} photoUrl={staffPhotoUrl(target.photo_path)} size="lg" />
        <div>
          <h2 className="font-serif text-2xl font-semibold text-ink">
            {fullName(target)}
            {isSelf && <span className="ml-2 font-sans text-sm font-normal text-ink-muted">(you)</span>}
          </h2>
          <p className="text-sm text-ink-muted">
            {roleLabel(target.role)}
            {target.level && ` · ${LEVEL_LABELS[target.level]}`}
          </p>
        </div>
        {manager && target.role === "stylist" && <StaffPhotoForm key={target.id} staffId={target.id} hasPhoto={Boolean(target.photo_path)} />}
      </div>

      <section aria-labelledby="week-heading" className={cardClass}>
        <div className={`${cardHeadClass} flex flex-wrap items-center justify-between gap-2`}>
          <h3 id="week-heading" className={cardTitleClass}>
            Week of {formatDay(week, true)}
          </h3>
          <div className="flex gap-2">
            <Link href={link({ week: addDays(week, -7) })} className={buttonClass("secondary", "sm")}>
              ← Previous
            </Link>
            <Link href={link({ week: startOfWeek(today) })} className={buttonClass("secondary", "sm")}>
              This week
            </Link>
            <Link href={link({ week: addDays(week, 7) })} className={buttonClass("secondary", "sm")}>
              Next →
            </Link>
          </div>
        </div>
        <ol className={listClass} aria-label="Week">
          {days.map((day) => (
            <li
              key={day.date}
              aria-label={formatDay(day.date)}
              className={`${rowClass} flex flex-wrap gap-x-4 gap-y-1 ${day.date === today ? "bg-navy-100/60" : "hover:bg-sunken/60"}`}
            >
              <span className="w-28 text-sm font-semibold">
                {formatDay(day.date)}
                {day.date === today && <span className="block text-xs font-medium text-navy-700">Today</span>}
              </span>
              <div className="flex flex-1 flex-col gap-1 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  {day.hours.length === 0 ? <span className="text-ink-muted">Off</span> : formatIntervals(day.hours)}
                  {day.changed && <Badge tone="blue">Changed hours</Badge>}
                  {day.open.length === 0 && <Badge tone="neutral">Salon closed</Badge>}
                </span>
                {day.timeOff.map((t, i) => (
                  <span key={t.id ?? i} className={`flex flex-wrap items-center gap-2 ${t.status === "approved" ? "text-ink" : "text-ink-muted"}`}>
                    {describeTimeOff(t)} <Badge tone={statusTone(t)}>{STATUS_LABELS[t.status]}</Badge>
                  </span>
                ))}
                {day.hours.length > 0 && formatIntervals(day.available) !== formatIntervals(day.hours) && (
                  <span className="text-ink-muted">Bookable: {day.available.length ? formatIntervals(day.available) : "none"}</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="weekly-heading" className={cardClass}>
        <h3 id="weekly-heading" className={`${cardHeadClass} ${cardTitleClass}`}>
          Weekly hours
        </h3>
        {manager ? (
          <HoursEditor key={target.id} action={saveWeeklyHours.bind(null, target.id)} initial={hoursRows} label="Weekly hours" />
        ) : (
          <dl className={listClass}>
            {WEEKDAYS.map((d) => (
              <div key={d} className="flex gap-4 px-5 py-2.5 text-sm">
                <dt className="w-28 font-semibold">{WEEKDAY_NAMES[d]}</dt>
                <dd className={weekly[d]?.length ? "" : "text-ink-muted"}>{weekly[d]?.length ? formatIntervals(weekly[d]) : "Off"}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="changes-heading" className={cardClass}>
        <h3 id="changes-heading" className={`${cardHeadClass} ${cardTitleClass}`}>
          One-off changes
        </h3>
        {changes.size === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">No upcoming changes.</p>
        ) : (
          <ul className={listClass} aria-label="Upcoming changes">
            {[...changes].map(([date, intervals]) => (
              <li key={date} className={`${rowClass} flex flex-wrap items-center gap-4 text-sm hover:bg-sunken/60`}>
                <span className="w-28 font-semibold">{formatDay(date)}</span>
                <span className="flex-1">{formatIntervals(intervals)}</span>
                {manager && (
                  <form action={removeDayChange.bind(null, target.id, date)}>
                    <button type="submit" className={buttonClass("secondary", "sm")} aria-label={`Remove change on ${formatDay(date)}`}>
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {manager && (
          <div className="border-t border-line bg-sunken/40">
            <DayChangeForm key={target.id} staffId={target.id} today={today} />
          </div>
        )}
      </section>

      <section aria-labelledby="time-off-heading" className={cardClass}>
        <h3 id="time-off-heading" className={`${cardHeadClass} ${cardTitleClass}`}>
          Time off
        </h3>
        {timeOff.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">No time off in the last 60 days or coming up.</p>
        ) : (
          <ul className={listClass} aria-label="Time off">
            {timeOff.map((t) => (
              <li key={t.id} className={`${rowClass} flex animate-fade-in flex-wrap items-center gap-x-4 gap-y-2 text-sm hover:bg-sunken/60`}>
                <span className="flex-1">
                  {describeTimeOff(t)}
                  {t.note && <span className="text-ink-muted"> · {t.note}</span>}
                </span>
                <Badge tone={statusTone(t)}>{STATUS_LABELS[t.status]}</Badge>
                {manager && t.status === "requested" && (
                  <>
                    <form action={decideTimeOff.bind(null, t.id!, "approved")}>
                      <button type="submit" className={buttonClass("primary", "sm")}>
                        Approve
                      </button>
                    </form>
                    <form action={decideTimeOff.bind(null, t.id!, "declined")}>
                      <button type="submit" className={buttonClass("secondary", "sm")}>
                        Decline
                      </button>
                    </form>
                  </>
                )}
                {(manager || (isSelf && t.status === "requested")) && (
                  <form action={deleteTimeOff.bind(null, t.id!)}>
                    <button type="submit" className={buttonClass("ghost", "sm", "text-danger")}>
                      {manager ? "Remove" : "Withdraw"}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {(manager || isSelf) && (
          <div className="border-t border-line bg-sunken/40">
            <TimeOffForm key={target.id} staffId={target.id} today={today} isRequest={!manager} />
          </div>
        )}
      </section>

      {(manager || isSelf) && (
        <section aria-labelledby="pay-heading" className={cardClass}>
          <h3 id="pay-heading" className={`${cardHeadClass} ${cardTitleClass}`}>
            Level and commission
          </h3>
          {compensation.data?.plan_id && (
            <p className="px-5 pt-4 text-sm text-ink-muted" data-testid="on-plan">
              Paid on a commission plan
              {can(me, "payroll") ? (
                <>
                  {" "}
                  (
                  <Link href="/settings/commission" className="text-link hover:underline">
                    Settings → Commission
                  </Link>
                  )
                </>
              ) : null}
              . The rates below apply only off a plan; the hourly rate always applies.
            </p>
          )}
          {manager ? (
            <CompensationForm
              key={target.id}
              staffId={target.id}
              level={target.level}
              servicePct={Number(compensation.data?.service_commission_pct ?? 0)}
              retailPct={Number(compensation.data?.retail_commission_pct ?? 0)}
              hourlyRateCents={compensation.data?.hourly_rate_cents ?? null}
            />
          ) : (
            <dl className="flex flex-wrap gap-8 px-5 py-4 text-sm">
              <div>
                <dt className="text-ink-muted">Level</dt>
                <dd className="font-semibold">{target.level ? LEVEL_LABELS[target.level] : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Service commission</dt>
                <dd className="font-semibold">{compensation.data ? `${Number(compensation.data.service_commission_pct)}%` : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Retail commission</dt>
                <dd className="font-semibold">{compensation.data ? `${Number(compensation.data.retail_commission_pct)}%` : "—"}</dd>
              </div>
              {compensation.data?.hourly_rate_cents != null && (
                <div>
                  <dt className="text-ink-muted">Hourly rate</dt>
                  <dd className="font-semibold">{formatPrice(compensation.data.hourly_rate_cents)}</dd>
                </div>
              )}
            </dl>
          )}
        </section>
      )}
    </AppShell>
  );
}

// Approved time off blocks bookings; requests wait for a manager.
function statusTone(t: TimeOff): Tone {
  return t.status === "approved" ? "green" : t.status === "requested" ? "amber" : "neutral";
}
