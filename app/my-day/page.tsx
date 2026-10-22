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

export const metadata: Metadata = { title: "My day" };

// A stylist's day on their phone: each client in order, with one tap for
// Started, Processing, Back in chair and Finished.
export default function MyDayPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <MyDay />
    </Suspense>
  );
}

async function MyDay() {
  const { supabase, staff: me } = await getCurrentStaff();
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
    </AppShell>
  );
}
