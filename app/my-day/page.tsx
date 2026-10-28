import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { ServiceTimer } from "@/components/service-timer";
import { StatusChip } from "@/components/ui/status-chip";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { TableCard } from "@/components/ui/table";
import { bookedSummary } from "@/lib/calendar";
import { getCurrentStaff } from "@/lib/auth";
import { describeTimeOff, formatDay, formatIntervals, formatLongDay } from "@/lib/schedule-format";
import { dayView } from "@/lib/scheduling/availability";
import { loadLocationSchedule, loadStaffSchedules, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, datesBetween, formatMinute, todayIn, toLocal } from "@/lib/scheduling/time";
import type { AppointmentStatus } from "@/lib/appointments";
import { PayTickets } from "@/components/pay-tickets";
import { pillClass } from "@/components/ui/page";
import { formatPrice } from "@/lib/services";
import { periodContaining, previousPeriod, ratesText } from "@/lib/payroll";
import { loadPayroll, loadPaySettings } from "@/lib/payroll-load";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { TipDetails } from "@/components/tip-details";
import { GoalAlertCard, GoalCard } from "@/components/goals";
import { AlertFrequencyPicker, GoalForm, RemoveGoal } from "@/components/goal-controls";
import { loadMyGoals } from "@/lib/goals/mine";
import { metricInfo } from "@/lib/goals/pacing";
import { averageTipPct, pctText } from "@/lib/tips";
import { loadLiveEarnings } from "@/lib/earnings-load";
import { LiveEarningsCard } from "./live-earnings";
import { Notices } from "./notices";
import { firstLetter } from "@/lib/initial";

export const metadata: Metadata = { title: "My day" };

// A disclosure's summary: a quiet text link with a turning chevron.
const summaryClass =
  "inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-link hover:text-link-hover hover:underline [&::-webkit-details-marker]:hidden before:inline-block before:text-ink-subtle before:transition-transform before:duration-(--motion-fast) before:content-['▸'] group-open:before:rotate-90";

// A stylist's day on their phone: each client in order, with optional taps
// for Start service, Processing, Back in chair and Finish service. The only
// place times are tapped: the front desk just checks clients in and out.
// Tapped times are what Denise learns from first.
// When a notice came: "9:40am", or "Mon, Oct 26" before today.
function noticeTime(at: Date, tz: string, today: string) {
  const local = toLocal(at, tz);
  return local.date === today ? formatMinute(local.minute) : new Date(`${local.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export default function MyDayPage({ searchParams }: PageProps<"/my-day">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <MyDay searchParams={searchParams} />
    </Suspense>
  );
}

async function MyDay({ searchParams }: Pick<PageProps<"/my-day">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  const tz = me.location.timezone;
  const today = todayIn(tz);
  // An assistant follows the stylist they assist (read-only: the stylist
  // taps their own times).
  const book = me.role === "assistant" ? me.assists_staff_id : me.id;
  const { data: stylist } = book && book !== me.id ? await supabase.from("staff").select("first_name").eq("id", book).maybeSingle() : { data: null };
  const { data, error } = await supabase
    .from("appointment_items")
    .select(
      "id, appointment_id, starts_at, active_minutes, processing_minutes, finishing_minutes, started_at, processing_started_at, processing_ended_at, finished_at, service:services(name), appointment:appointments!inner(status, client:clients(first_name, last_name))",
    )
    .eq("staff_id", book ?? me.id)
    .eq("location_id", me.location.id)
    .gte("starts_at", startOfLocalDay(today, tz).toISOString())
    .lt("starts_at", startOfLocalDay(addDays(today, 1), tz).toISOString())
    .not("appointment.status", "in", "(canceled)")
    .order("starts_at");
  if (error) throw error;

  // Notices for them in the app: unread, newest first.
  const { data: notices } = await supabase
    .from("notifications")
    .select("id, body, created_at")
    .eq("staff_id", me.id)
    .eq("channel", "app")
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  const visits = data.map((i) => ({ ...i, minutes: i.active_minutes + i.processing_minutes + i.finishing_minutes }));
  const counted = visits.filter((i) => i.appointment.status !== "no_show").map((i) => ({ appointmentId: i.appointment_id, minutes: i.minutes }));

  return (
    <AppShell section="my-day" me={me}>
      <PageHeader title="My day" description={`${stylist ? `${stylist.first_name}'s day, ` : ""}${formatLongDay(today, false)} · ${bookedSummary(counted)}`} />
      <div className="max-w-2xl">
      <Notices notices={(notices ?? []).map((n) => ({ id: n.id, body: n.body, when: noticeTime(new Date(n.created_at), tz, today) }))} />
      {me.role === "assistant" ? (
        <p className="mb-4 text-sm text-ink-muted" data-testid="assisting">
          {stylist ? `You're assisting ${stylist.first_name}: here's their day, as it's booked.` : "You're not assigned to a stylist yet. Ask a manager to choose one on your Team page."}
        </p>
      ) : (
        <p className="mb-4 text-sm text-ink-muted" data-testid="taps-optional">
          Tapping your times is optional. When you do, Denise learns how long you really take; otherwise she goes by check-in and checkout.
        </p>
      )}
      {me.role === "assistant" && !book ? null : visits.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState>Nothing booked {stylist ? `for ${stylist.first_name}` : "for you"} today.</EmptyState>
        </div>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Today's services">
          {visits.map((i) => {
            const client = i.appointment.client;
            const name = client ? `${client.first_name}${client.last_name ? ` ${firstLetter(client.last_name)}.` : ""}` : "Walk-in";
            const status = i.appointment.status as AppointmentStatus;
            const start = toLocal(new Date(i.starts_at), tz).minute;
            return (
              <li key={i.id} className="rounded-lg border border-line bg-surface p-4" data-item-id={i.id}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-13 text-ink-muted tabular-nums">
                      {formatMinute(start)}–{formatMinute(start + i.minutes)}
                    </p>
                    <p className="mt-0.5 text-base font-semibold text-ink">{name}</p>
                    <p className="text-sm text-ink-muted">{i.service.name}</p>
                  </div>
                  <StatusChip status={status} />
                </div>
                {status !== "no_show" && me.role !== "assistant" && (
                  <ServiceTimer
                    itemId={i.id}
                    big
                    timeZone={tz}
                    times={{ startedAt: i.started_at, processingStartedAt: i.processing_started_at, processingEndedAt: i.processing_ended_at, finishedAt: i.finished_at }}
                    hasProcessing={i.processing_minutes > 0}
                    bookedMinutes={i.minutes}
                    canRecord={status !== "completed" || i.started_at !== null}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
      <MyWeekSection supabase={supabase} me={me} />
      {me.role !== "assistant" && <LiveEarningsSection supabase={supabase} me={me} />}
      {me.role !== "assistant" && <MyGoalsSection supabase={supabase} me={me} />}
      <MyEarnings supabase={supabase} me={me} last={params.pay === "last"} />
      </div>
    </AppShell>
  );
}

// Their published hours for the week ahead (what the team schedule
// published; drafts never show here), with approved time off.
async function MyWeekSection({ supabase, me }: { supabase: Awaited<ReturnType<typeof getCurrentStaff>>["supabase"]; me: NonNullable<Awaited<ReturnType<typeof getCurrentStaff>>["staff"]> }) {
  const today = todayIn(me.location.timezone);
  const end = addDays(today, 6);
  const [location, schedules] = await Promise.all([loadLocationSchedule(supabase, me.location), loadStaffSchedules(supabase, [me.id], today, end)]);
  const schedule = schedules.get(me.id)!;
  return (
    <Section
      title="My week"
      titleId="my-week-heading"
      className="mt-10"
      data-testid="my-week"
      actions={
        <Link href="/time-off" className={buttonClass("quiet", "sm")}>
          Ask for time off
        </Link>
      }
    >
      <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {datesBetween(today, end).map((date) => {
          const day = dayView(schedule, location, date);
          const off = day.timeOff.filter((t) => t.status === "approved");
          return (
            <li key={date} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
              <span className="font-medium text-ink">{date === today ? "Today" : formatDay(date)}</span>
              <span className={day.hours.length ? "text-right text-ink tabular-nums" : "text-ink-muted"}>
                {day.hours.length ? formatIntervals(day.hours) : "Off"}
                {off.length > 0 && <span className="block text-13 text-ink-muted">{off.map(describeTimeOff).join(", ")}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

async function LiveEarningsSection({ supabase, me }: { supabase: Awaited<ReturnType<typeof getCurrentStaff>>["supabase"]; me: NonNullable<Awaited<ReturnType<typeof getCurrentStaff>>["staff"]> }) {
  return <LiveEarningsCard live={await loadLiveEarnings(supabase, me)} />;
}

// Their own goals, paced, with Denise's alert at the top when it's due.
async function MyGoalsSection({ supabase, me }: { supabase: Awaited<ReturnType<typeof getCurrentStaff>>["supabase"]; me: NonNullable<Awaited<ReturnType<typeof getCurrentStaff>>["staff"]> }) {
  const goals = await loadMyGoals(supabase, me);
  return (
    <Section title="My goals" titleId="goals-heading" actions={<AlertFrequencyPicker value={goals.frequency} />} className="mt-10" data-testid="my-goals">
      {goals.alert && <GoalAlertCard alert={goals.alert} today={goals.today} />}
      {goals.pacings.length ? (
        <ul className="mb-4 flex flex-col gap-3">
          {goals.pacings.map((p) => (
            <GoalCard key={p.goal.id} pacing={p}>
              {!p.setByOwner && (
                <div className="-mb-1 -ml-2.5">
                  <RemoveGoal goalId={p.goal.id} label={`${metricInfo(p.goal.metric).label} goal`} />
                </div>
              )}
              {p.setByOwner && <p className="text-xs text-ink-subtle">Set by the owner.</p>}
            </GoalCard>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-ink-muted">No goals yet. Set one and Denise will keep you on pace.</p>
      )}
      <GoalForm fixedStaffId={me.id} />
    </Section>
  );
}

// Their own earnings only (payroll_sales gives anyone but owners and
// managers just their own lines and tips): this pay period so far, or the
// last one.
async function MyEarnings({ supabase, me, last }: { supabase: Awaited<ReturnType<typeof getCurrentStaff>>["supabase"]; me: NonNullable<Awaited<ReturnType<typeof getCurrentStaff>>["staff"]>; last: boolean }) {
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const settings = await loadPaySettings(supabase, me.business_id);
  const current = periodContaining(settings.kind, settings.anchor, today);
  const period = last ? previousPeriod(settings.kind, settings.anchor, current) : { from: current.from, to: today };
  const [pay] = await loadPayroll(supabase, me.business_id, tz, period, today, me.id);
  if (!pay) return null;
  const rows: [string, number, string?][] = [
    ["Services", pay.serviceCents],
    ["Service commission", pay.serviceCommissionCents, ratesText(pay.rates.service, (v) => `${v}%`) || undefined],
    ["Retail", pay.retailCents],
    ["Retail commission", pay.retailCommissionCents, ratesText(pay.rates.retail, (v) => `${v}%`) || undefined],
    ...(pay.feeCents !== 0 ? ([["Back-bar fees (taken off services first)", -pay.feeCents]] as [string, number][]) : []),
    ["Tips", pay.tipCents],
    ...(pay.minutes !== null ? ([["Hourly pay", pay.hourlyPayCents, ratesText(pay.rates.hourly, (c) => `${formatPrice(c)}/h`)]] as [string, number, string][]) : []),
  ];
  return (
    <Section
      title="My earnings"
      titleId="earnings-heading"
      description={`${formatLongDay(period.from, false)} to ${formatLongDay(period.to, false)}${last ? "" : " so far"}`}
      actions={
        <nav aria-label="Earnings period" className="flex gap-2">
          <Link href="/my-day" className={pillClass(!last)} aria-current={!last ? "page" : undefined}>
            This period
          </Link>
          <Link href="/my-day?pay=last" className={pillClass(last)} aria-current={last ? "page" : undefined}>
            Last period
          </Link>
        </nav>
      }
      className="mt-10"
      data-testid="my-earnings"
    >
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <dl className="divide-y divide-line text-sm tabular-nums">
          {rows.map(([label, cents, note]) => (
            <div key={label} className="flex justify-between gap-3 px-4 py-3">
              <dt className="text-ink-muted">
                {label}
                {note && <span className="text-xs text-ink-subtle"> ({note})</span>}
              </dt>
              <dd className="text-right text-ink">{formatPrice(cents)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 bg-sunken/50 px-4 py-3 font-semibold text-ink">
            <dt>Total pay</dt>
            <dd className="text-right" data-testid="my-pay-total">
              {formatPrice(pay.totalCents)}
            </dd>
          </div>
        </dl>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Commission is on what clients paid before tax, at your rate{pay.rates.plans.length ? ` or plan (${pay.rates.plans.join(", ")})` : ""} when each sale was made. Refunds come off in the period they happen.
      </p>
      {pay.tipCents !== 0 && (
        <details className="group mt-6" data-testid="my-tips">
          <summary className={summaryClass}>
            My tips ({formatPrice(pay.tipCents)}, {pctText(averageTipPct(pay.tickets))} average)
          </summary>
          <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface p-4">
            <TipDetails tickets={pay.tickets} period={period} timeZone={tz} linkSales={false} ownView />
          </div>
        </details>
      )}
      {pay.tickets.length > 0 && (
        <details className="group mt-4">
          <summary className={summaryClass}>Tickets behind it ({pay.tickets.length})</summary>
          <TableCard className="mt-3">
            <PayTickets tickets={pay.tickets} timeZone={tz} linkSales={false} label="My tickets" />
          </TableCard>
        </details>
      )}
    </Section>
  );
}
