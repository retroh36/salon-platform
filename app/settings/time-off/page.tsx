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
import { PtoPolicyForm, TypesEditor } from "./pto-forms";
import { loadPolicyRow, loadTimeOffTypes } from "@/lib/pto-load";

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
  const [business, blackouts, types, policy] = await Promise.all([
    supabase.from("businesses").select("time_off_notice_days").eq("id", me.business_id).single(),
    supabase.from("time_off_blackouts").select("id, starts_on, ends_on, label").gte("ends_on", today).order("starts_on"),
    loadTimeOffTypes(supabase, me.business_id),
    loadPolicyRow(supabase, me.business_id),
  ]);
  const hours = (m: number) => m / 60;
  if (business.error) throw business.error;
  if (blackouts.error) throw blackouts.error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Time off" description="The kinds of time off, PTO balances, when the team should ask, and dates the salon needs everyone in." />
      <SettingsNav current="time-off" me={me} />
      <div className="flex max-w-2xl flex-col gap-6">
        <Card title="Types of time off" titleId="types-heading" description="What the team chooses when they ask. Time off of a type that uses PTO comes out of their balance.">
          <TypesEditor initial={types.filter((t) => !t.archived).map((t) => ({ id: t.id, name: t.name, reason: t.reason, usesPto: t.usesPto }))} />
        </Card>
        <Card title="PTO" titleId="pto-heading" description="How paid time off is earned, what carries over into a new year, and the most anyone can hold. Balances are on Scheduling, Balances.">
          <PtoPolicyForm
            value={{
              isOn: policy?.is_on ?? false,
              accrual: (policy?.accrual ?? "yearly") as "yearly",
              yearlyHours: hours(policy?.yearly_minutes ?? 4800),
              prorate: policy?.prorate_first_year ?? true,
              earnHours: hours(policy?.earn_minutes ?? 60),
              perHours: policy?.per_hours ?? 30,
              periodHours: hours(policy?.period_minutes ?? 240),
              yearStartMonth: policy?.year_start_month ?? 1,
              carryOver: (policy?.carry_over ?? "up_to") as "up_to",
              carryHours: hours(policy?.carry_minutes ?? 2400),
              capHours: policy?.cap_minutes != null ? hours(policy.cap_minutes) : null,
              trackingFrom: policy?.tracking_from ?? `${today.slice(0, 4)}-01-01`,
              roles: policy?.roles ?? ["manager", "front_desk", "stylist", "assistant"],
            }}
          />
        </Card>
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
