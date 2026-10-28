import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDay } from "@/lib/schedule-format";
import { todayIn } from "@/lib/scheduling/time";
import { SettingsNav } from "../settings-nav";
import { removeBlackout } from "./actions";
import { BlackoutForm, NoticeForm } from "./time-off-forms";

export const metadata: Metadata = { title: "Time off" };

export default function TimeOffSettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <TimeOffSettings />
    </Suspense>
  );
}

// How far ahead time off should be asked for, and dates the salon needs
// everyone (requests then still go through, flagged for whoever decides).
async function TimeOffSettings() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const today = todayIn(me.location.timezone);
  const [business, blackouts] = await Promise.all([
    supabase.from("businesses").select("time_off_notice_days").eq("id", me.business_id).single(),
    supabase.from("time_off_blackouts").select("id, starts_on, ends_on, label").gte("ends_on", today).order("starts_on"),
  ]);
  if (business.error) throw business.error;
  if (blackouts.error) throw blackouts.error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Time off" description="When the team should ask for time off, and dates the salon needs everyone in." />
      <SettingsNav current="time-off" me={me} />
      <div className="flex max-w-2xl flex-col gap-6">
        <Card title="Notice" titleId="notice-heading" description="Requests that start sooner than this are marked short notice in Requests. They still go through.">
          <NoticeForm days={business.data.time_off_notice_days} />
        </Card>
        <Card title="Blackout dates" titleId="blackouts-heading" description="Busy times like the holidays or prom season. Requests that touch them are flagged, and the team sees them when they ask.">
          {blackouts.data.length > 0 && (
            <ul className="mb-4 divide-y divide-line rounded-lg border border-line" aria-label="Blackout dates">
              {blackouts.data.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium text-ink">{b.label ?? "Blackout"}</span>
                    <span className="text-ink-muted"> · {b.starts_on === b.ends_on ? formatDay(b.starts_on, true) : `${formatDay(b.starts_on)} – ${formatDay(b.ends_on, true)}`}</span>
                  </span>
                  <form action={removeBlackout.bind(null, b.id)}>
                    <button type="submit" className={buttonClass("quiet", "sm", "text-danger")} aria-label={`Remove ${b.label ?? "blackout"}`}>
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <BlackoutForm today={today} />
        </Card>
      </div>
    </AppShell>
  );
}
