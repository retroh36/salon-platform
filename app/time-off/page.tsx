import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Badge, PageHeader, Section, type Tone } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { describeTimeOff, formatDay, STATUS_LABELS } from "@/lib/schedule-format";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { deleteTimeOff } from "../schedule/actions";
import { TimeOffForm } from "../schedule/time-off-form";

export const metadata: Metadata = { title: "Time off" };

export default function TimeOffPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <TimeOff />
    </Suspense>
  );
}

const TONE: Record<keyof typeof STATUS_LABELS, Tone> = { requested: "warning", approved: "success", declined: "neutral" };

// Asking for time off, made for a phone: the form, the salon's notice
// period and blackout dates, and what came of each request.
async function TimeOff() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  const today = todayIn(me.location.timezone);
  const [mine, blackouts, business] = await Promise.all([
    supabase
      .from("staff_time_off")
      .select("id, starts_on, ends_on, start_minute, end_minute, reason, note, status, decline_reason")
      .eq("staff_id", me.id)
      .gte("ends_on", addDays(today, -60))
      .order("starts_on", { ascending: false }),
    supabase.from("time_off_blackouts").select("id, starts_on, ends_on, label").gte("ends_on", today).order("starts_on").limit(10),
    supabase.from("businesses").select("time_off_notice_days").single(),
  ]);
  if (mine.error) throw mine.error;
  if (blackouts.error) throw blackouts.error;
  if (business.error) throw business.error;
  const notice = business.data.time_off_notice_days;
  const manager = canManage(me.role);

  return (
    <AppShell section={manager ? "team" : "my-day"} me={me}>
      <PageHeader title="Time off" description={manager ? "Time off you add for yourself is approved straight away." : "Ask for time off. A manager approves it."} />
      <div className="flex max-w-xl flex-col gap-8">
        <Section title={manager ? "Add time off" : "Ask for time off"} titleId="ask-heading">
          <div className="rounded-lg border border-line bg-surface">
            <TimeOffForm staffId={me.id} today={today} isRequest={!manager} />
          </div>
          {!manager && (
            <ul className="mt-3 flex flex-col gap-1 text-13 text-ink-muted" data-testid="time-off-rules">
              {notice > 0 && <li>Ask at least {notice === 7 ? "a week" : `${notice} days`} ahead. Sooner is fine, but it&rsquo;s marked short notice.</li>}
              {blackouts.data.map((b) => (
                <li key={b.id}>
                  Blackout: {b.label ? `${b.label}, ` : ""}
                  {b.starts_on === b.ends_on ? formatDay(b.starts_on) : `${formatDay(b.starts_on)} – ${formatDay(b.ends_on)}`}. Requests then are flagged.
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="My time off" titleId="mine-heading">
          {mine.data.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing in the last 60 days or coming up.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface" aria-labelledby="mine-heading">
              {mine.data.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span>
                    {describeTimeOff({ startsOn: t.starts_on, endsOn: t.ends_on, startMinute: t.start_minute, endMinute: t.end_minute, status: t.status, reason: t.reason })}
                    {t.decline_reason && <span className="block text-13 text-ink-muted">Declined: {t.decline_reason}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={TONE[t.status]}>{STATUS_LABELS[t.status]}</Badge>
                    {t.status === "requested" && (
                      <form action={deleteTimeOff.bind(null, t.id)}>
                        <button type="submit" className={buttonClass("quiet", "sm", "text-danger")}>
                          Withdraw
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </AppShell>
  );
}
