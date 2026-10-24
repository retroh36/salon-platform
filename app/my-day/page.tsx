import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { ServiceTimer } from "@/components/service-timer";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/ui/page";
import { bookedSummary } from "@/lib/calendar";
import { getCurrentStaff } from "@/lib/auth";
import { formatLongDay } from "@/lib/schedule-format";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, formatMinute, todayIn, toLocal } from "@/lib/scheduling/time";
import type { AppointmentStatus } from "@/lib/appointments";
import { PayTickets } from "@/components/pay-tickets";
import { pillClass } from "@/components/ui/page";
import { formatPrice } from "@/lib/services";
import { periodContaining, previousPeriod, ratesText } from "@/lib/payroll";
import { loadPayroll, loadPaySettings } from "@/lib/payroll-load";
import Link from "next/link";
import { TipDetails } from "@/components/tip-details";
import { GoalAlertCard, GoalCard } from "@/components/goals";
import { AlertFrequencyPicker, GoalForm, RemoveGoal } from "@/components/goal-controls";
import { loadMyGoals } from "@/lib/goals/mine";
import { metricInfo } from "@/lib/goals/pacing";
import { averageTipPct, pctText } from "@/lib/tips";

export const metadata: Metadata = { title: "My day" };

// A stylist's day on their phone: each client in order, with optional taps
// for Start service, Processing, Back in chair and Finish service. The only
// place times are tapped: the front desk just checks clients in and out.
// Tapped times are what Denise learns from first.
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
  const { data, error } = await supabase
    .from("appointment_items")
    .select(
      "id, appointment_id, starts_at, active_minutes, processing_minutes, finishing_minutes, started_at, processing_started_at, processing_ended_at, finished_at, service:services(name), appointment:appointments!inner(status, client:clients(first_name, last_name))",
    )
    .eq("staff_id", me.id)
    .eq("location_id", me.location.id)
    .gte("starts_at", startOfLocalDay(today, tz).toISOString())
    .lt("starts_at", startOfLocalDay(addDays(today, 1), tz).toISOString())
    .not("appointment.status", "in", "(canceled)")
    .order("starts_at");
  if (error) throw error;

  const visits = data.map((i) => ({ ...i, minutes: i.active_minutes + i.processing_minutes + i.finishing_minutes }));
  const counted = visits.filter((i) => i.appointment.status !== "no_show").map((i) => ({ appointmentId: i.appointment_id, minutes: i.minutes }));

  return (
    <AppShell section="my-day" me={me}>
      <PageHeader title="My day" description={`${formatLongDay(today, false)} · ${bookedSummary(counted)}`} />
      <p className="mx-auto mb-4 max-w-xl text-sm text-ink-muted" data-testid="taps-optional">
        Tapping your times is optional. When you do, Denise learns how long you really take; otherwise she goes by check-in and checkout.
      </p>
      {visits.length === 0 ? (
        <p className="rounded-xl bg-sunken px-4 py-8 text-center text-ink-muted">Nothing booked for you today.</p>
      ) : (
        <ol className="mx-auto flex max-w-xl flex-col gap-3" aria-label="Today's services">
          {visits.map((i) => {
            const client = i.appointment.client;
            const name = client ? `${client.first_name}${client.last_name ? ` ${client.last_name[0]}.` : ""}` : "Walk-in";
            const status = i.appointment.status as AppointmentStatus;
            const start = toLocal(new Date(i.starts_at), tz).minute;
            return (
              <li key={i.id} className="rounded-xl border border-line bg-surface p-4 shadow-card" data-item-id={i.id}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-muted tabular-nums">
                      {formatMinute(start)}–{formatMinute(start + i.minutes)}
                    </p>
                    <p className="font-serif text-xl font-semibold text-ink">{name}</p>
                    <p className="text-ink-muted">{i.service.name}</p>
                  </div>
                  <StatusChip status={status} />
                </div>
                {status !== "no_show" && (
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
      <MyGoalsSection supabase={supabase} me={me} />
      <MyEarnings supabase={supabase} me={me} last={params.pay === "last"} />
    </AppShell>
  );
}

// Their own goals, paced, with Denise's alert at the top when it's due.
async function MyGoalsSection({ supabase, me }: { supabase: Awaited<ReturnType<typeof getCurrentStaff>>["supabase"]; me: NonNullable<Awaited<ReturnType<typeof getCurrentStaff>>["staff"]> }) {
  const goals = await loadMyGoals(supabase, me);
  return (
    <section aria-labelledby="goals-heading" className="mx-auto mt-8 max-w-xl" data-testid="my-goals">
      {goals.alert && <GoalAlertCard alert={goals.alert} today={goals.today} />}
      <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="goals-heading" className="font-serif text-xl font-semibold text-ink">
            My goals
          </h2>
          <AlertFrequencyPicker value={goals.frequency} />
        </div>
        {goals.pacings.length ? (
          <ul className="mb-3 flex flex-col gap-3">
            {goals.pacings.map((p) => (
              <GoalCard key={p.goal.id} pacing={p}>
                {!p.setByOwner && <RemoveGoal goalId={p.goal.id} label={`${metricInfo(p.goal.metric).label} goal`} />}
                {p.setByOwner && <p className="text-xs text-ink-muted">Set by the owner.</p>}
              </GoalCard>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-ink-muted">No goals yet. Set one and Denise will keep you on pace.</p>
        )}
        <GoalForm fixedStaffId={me.id} />
      </div>
    </section>
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
    ["Tips", pay.tipCents],
    ...(pay.minutes !== null ? ([["Hourly pay", pay.hourlyPayCents, ratesText(pay.rates.hourly, (c) => `${formatPrice(c)}/h`)]] as [string, number, string][]) : []),
  ];
  return (
    <section aria-labelledby="earnings-heading" className="mx-auto mt-8 max-w-xl rounded-xl border border-line bg-surface p-4 shadow-card" data-testid="my-earnings">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="earnings-heading" className="font-serif text-xl font-semibold text-ink">
            My earnings
          </h2>
          <p className="text-sm text-ink-muted">
            {formatLongDay(period.from, false)} to {formatLongDay(period.to, false)}
            {last ? "" : " so far"}
          </p>
        </div>
        <nav aria-label="Earnings period" className="flex gap-2">
          <Link href="/my-day" className={pillClass(!last)} aria-current={!last ? "page" : undefined}>
            This period
          </Link>
          <Link href="/my-day?pay=last" className={pillClass(last)} aria-current={last ? "page" : undefined}>
            Last period
          </Link>
        </nav>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm tabular-nums sm:grid-cols-2">
        {rows.map(([label, cents, note]) => (
          <div key={label} className="flex justify-between gap-2 border-b border-line pb-1.5">
            <dt className="text-ink-muted">
              {label}
              {note && <span className="text-xs"> ({note})</span>}
            </dt>
            <dd>{formatPrice(cents)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex justify-between font-semibold">
        <span>Total pay</span>
        <span className="tabular-nums" data-testid="my-pay-total">
          {formatPrice(pay.totalCents)}
        </span>
      </p>
      <p className="mt-1 text-xs text-ink-muted">Commission is on what clients paid before tax, at your rate when each sale was made. Refunds come off in the period they happen.</p>
      {pay.tipCents !== 0 && (
        <details className="mt-3" data-testid="my-tips">
          <summary className="cursor-pointer text-sm font-medium text-link">
            My tips ({formatPrice(pay.tipCents)}, {pctText(averageTipPct(pay.tickets))} average)
          </summary>
          <div className="mt-3">
            <TipDetails tickets={pay.tickets} period={period} timeZone={tz} linkSales={false} ownView />
          </div>
        </details>
      )}
      {pay.tickets.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-link">Tickets behind it ({pay.tickets.length})</summary>
          <div className="-mx-4 mt-2">
            <PayTickets tickets={pay.tickets} timeZone={tz} linkSales={false} label="My tickets" />
          </div>
        </details>
      )}
    </section>
  );
}
