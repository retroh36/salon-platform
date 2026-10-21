import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { describeTimeOff, formatDay, formatIntervals, STATUS_LABELS } from "@/lib/schedule-format";
import { LEVEL_LABELS, WEEKDAY_NAMES } from "@/lib/schedule-forms";
import { dayView, type TimeOff } from "@/lib/scheduling/availability";
import { loadLocationSchedule, loadStaffSchedules } from "@/lib/scheduling/load";
import { addDays, datesBetween, isLocalDate, minuteToTime, startOfWeek, todayIn, WEEKDAYS } from "@/lib/scheduling/time";
import { fullName, roleLabel, sortStaff } from "@/lib/staff";
import { decideTimeOff, deleteTimeOff, removeDayChange, saveWeeklyHours } from "./actions";
import { CompensationForm } from "./compensation-form";
import { DayChangeForm } from "./day-change-form";
import { HoursEditor, type HoursRows } from "./hours-editor";
import { TimeOffForm } from "./time-off-form";

export const metadata: Metadata = { title: "Schedule · Salon Platform" };

export default function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Schedule searchParams={searchParams} />
    </Suspense>
  );
}

const sectionClass = "mb-8 rounded-xl border border-neutral-200 bg-white";
const headingClass = "border-b border-neutral-200 px-5 py-3 font-medium";
const smallButton = "rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100";

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
    .select("id, first_name, last_name, role, level, is_active, location_id");
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
      .select("service_commission_pct, retail_commission_pct")
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
    <AppShell section="schedule" businessName={me.location.business?.name} userName={me.first_name}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Schedule</h1>
        <Link href="/schedule/opening-hours" className="text-sm text-neutral-600 hover:text-neutral-900">
          Opening hours
        </Link>
      </div>

      {manager && pending.data.length > 0 && (
        <section aria-labelledby="requests-heading" className={`${sectionClass} border-amber-300`}>
          <h2 id="requests-heading" className={`${headingClass} bg-amber-50`}>
            Time off requests ({pending.data.length})
          </h2>
          <ul className="divide-y divide-neutral-100">
            {pending.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <span className="min-w-36 font-medium">{staffName.get(r.staff_id)}</span>
                <span className="flex-1 text-sm">
                  {describeTimeOff({ startsOn: r.starts_on, endsOn: r.ends_on, startMinute: r.start_minute, endMinute: r.end_minute, status: r.status, reason: r.reason })}
                  {r.note && <span className="text-neutral-500"> · {r.note}</span>}
                </span>
                <form action={decideTimeOff.bind(null, r.id, "approved")}>
                  <button type="submit" className={smallButton}>
                    Approve
                  </button>
                </form>
                <form action={decideTimeOff.bind(null, r.id, "declined")}>
                  <button type="submit" className={smallButton}>
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
            <Link
              key={s.id}
              href={link({ staff: s.id })}
              aria-current={s.id === target.id ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${s.id === target.id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100"}`}
            >
              {s.first_name}
            </Link>
          ))}
        </nav>
      )}

      <div className="mb-4">
        <h2 className="text-xl font-semibold">
          {fullName(target)}
          {isSelf && <span className="ml-2 text-sm font-normal text-neutral-500">(you)</span>}
        </h2>
        <p className="text-sm text-neutral-500">
          {roleLabel(target.role)}
          {target.level && ` · ${LEVEL_LABELS[target.level]}`}
        </p>
      </div>

      <section aria-labelledby="week-heading" className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
          <h3 id="week-heading" className="font-medium">
            Week of {formatDay(week, true)}
          </h3>
          <div className="flex gap-2 text-sm">
            <Link href={link({ week: addDays(week, -7) })} className={smallButton}>
              ← Previous
            </Link>
            <Link href={link({ week: startOfWeek(today) })} className={smallButton}>
              This week
            </Link>
            <Link href={link({ week: addDays(week, 7) })} className={smallButton}>
              Next →
            </Link>
          </div>
        </div>
        <ol className="divide-y divide-neutral-100" aria-label="Week">
          {days.map((day) => (
            <li
              key={day.date}
              aria-label={formatDay(day.date)}
              className={`flex flex-wrap gap-x-4 gap-y-1 px-5 py-3 ${day.date === today ? "bg-neutral-50" : ""}`}
            >
              <span className="w-28 text-sm font-medium">
                {formatDay(day.date)}
                {day.date === today && <span className="block text-xs font-normal text-neutral-500">Today</span>}
              </span>
              <div className="flex flex-1 flex-col gap-1 text-sm">
                <span>
                  {day.hours.length === 0 ? <span className="text-neutral-400">Off</span> : formatIntervals(day.hours)}
                  {day.changed && <Badge tone="blue">Changed hours</Badge>}
                  {day.open.length === 0 && <Badge tone="neutral">Salon closed</Badge>}
                </span>
                {day.timeOff.map((t, i) => (
                  <span key={t.id ?? i} className={t.status === "approved" ? "text-red-700" : "text-neutral-500"}>
                    {describeTimeOff(t)} <Badge tone={statusTone(t)}>{STATUS_LABELS[t.status]}</Badge>
                  </span>
                ))}
                {day.hours.length > 0 && formatIntervals(day.available) !== formatIntervals(day.hours) && (
                  <span className="text-neutral-500">
                    Bookable: {day.available.length ? formatIntervals(day.available) : "none"}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="weekly-heading" className={sectionClass}>
        <h3 id="weekly-heading" className={headingClass}>
          Weekly hours
        </h3>
        {manager ? (
          <HoursEditor key={target.id} action={saveWeeklyHours.bind(null, target.id)} initial={hoursRows} label="Weekly hours" />
        ) : (
          <dl className="divide-y divide-neutral-100">
            {WEEKDAYS.map((d) => (
              <div key={d} className="flex gap-4 px-5 py-2 text-sm">
                <dt className="w-28 font-medium">{WEEKDAY_NAMES[d]}</dt>
                <dd className={weekly[d]?.length ? "" : "text-neutral-400"}>{weekly[d]?.length ? formatIntervals(weekly[d]) : "Off"}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="changes-heading" className={sectionClass}>
        <h3 id="changes-heading" className={headingClass}>
          One-off changes
        </h3>
        {changes.size === 0 ? (
          <p className="px-5 py-3 text-sm text-neutral-500">No upcoming changes.</p>
        ) : (
          <ul className="divide-y divide-neutral-100" aria-label="Upcoming changes">
            {[...changes].map(([date, intervals]) => (
              <li key={date} className="flex flex-wrap items-center gap-4 px-5 py-3 text-sm">
                <span className="w-28 font-medium">{formatDay(date)}</span>
                <span className="flex-1">{formatIntervals(intervals)}</span>
                {manager && (
                  <form action={removeDayChange.bind(null, target.id, date)}>
                    <button type="submit" className={smallButton} aria-label={`Remove change on ${formatDay(date)}`}>
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {manager && (
          <div className="border-t border-neutral-200">
            <DayChangeForm key={target.id} staffId={target.id} today={today} />
          </div>
        )}
      </section>

      <section aria-labelledby="time-off-heading" className={sectionClass}>
        <h3 id="time-off-heading" className={headingClass}>
          Time off
        </h3>
        {timeOff.length === 0 ? (
          <p className="px-5 py-3 text-sm text-neutral-500">No time off in the last 60 days or coming up.</p>
        ) : (
          <ul className="divide-y divide-neutral-100" aria-label="Time off">
            {timeOff.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
                <span className="flex-1">
                  {describeTimeOff(t)}
                  {t.note && <span className="text-neutral-500"> · {t.note}</span>}
                </span>
                <Badge tone={statusTone(t)}>{STATUS_LABELS[t.status]}</Badge>
                {manager && t.status === "requested" && (
                  <>
                    <form action={decideTimeOff.bind(null, t.id!, "approved")}>
                      <button type="submit" className={smallButton}>
                        Approve
                      </button>
                    </form>
                    <form action={decideTimeOff.bind(null, t.id!, "declined")}>
                      <button type="submit" className={smallButton}>
                        Decline
                      </button>
                    </form>
                  </>
                )}
                {(manager || (isSelf && t.status === "requested")) && (
                  <form action={deleteTimeOff.bind(null, t.id!)}>
                    <button type="submit" className={smallButton}>
                      {manager ? "Remove" : "Withdraw"}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {(manager || isSelf) && (
          <div className="border-t border-neutral-200">
            <TimeOffForm key={target.id} staffId={target.id} today={today} isRequest={!manager} />
          </div>
        )}
      </section>

      {(manager || isSelf) && (
        <section aria-labelledby="pay-heading" className={sectionClass}>
          <h3 id="pay-heading" className={headingClass}>
            Level and commission
          </h3>
          {manager ? (
            <CompensationForm
              key={target.id}
              staffId={target.id}
              level={target.level}
              servicePct={Number(compensation.data?.service_commission_pct ?? 0)}
              retailPct={Number(compensation.data?.retail_commission_pct ?? 0)}
            />
          ) : (
            <dl className="flex flex-wrap gap-8 px-5 py-4 text-sm">
              <div>
                <dt className="text-neutral-500">Level</dt>
                <dd>{target.level ? LEVEL_LABELS[target.level] : "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Service commission</dt>
                <dd>{compensation.data ? `${Number(compensation.data.service_commission_pct)}%` : "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Retail commission</dt>
                <dd>{compensation.data ? `${Number(compensation.data.retail_commission_pct)}%` : "—"}</dd>
              </div>
            </dl>
          )}
        </section>
      )}
    </AppShell>
  );
}

function statusTone(t: TimeOff) {
  return t.status === "approved" ? "red" : t.status === "requested" ? "amber" : "neutral";
}

function Badge({ tone, children }: { tone: "red" | "amber" | "blue" | "neutral"; children: React.ReactNode }) {
  const tones = {
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-800",
    blue: "bg-blue-50 text-blue-700",
    neutral: "bg-neutral-100 text-neutral-600",
  };
  return <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
