import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadPaySettings } from "@/lib/payroll-load";
import { SettingsNav } from "../settings-nav";
import { PayrollHoursForm, PayrollSettingsForm } from "./payroll-settings";
import { formatDay } from "@/lib/schedule-format";
import { toLocal } from "@/lib/scheduling/time";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Payroll settings" };

export default function PayrollSettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <PayrollSettings />
    </Suspense>
  );
}

async function PayrollSettings() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "payroll")) redirect("/dashboard");
  const [settings, changes] = await Promise.all([
    loadPaySettings(supabase, me.business_id),
    supabase.from("payroll_hours_changes").select("id, to_basis, created_at, staff:by_staff_id(first_name, last_name)").eq("business_id", me.business_id).order("created_at", { ascending: false }).limit(5),
  ]);
  if (changes.error) throw changes.error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Payroll" description="How often you run payroll, and which hours pay people paid by the hour. Commission plans (tiers, back-bar fees, hourly) are on Settings → Commission; own rates and hourly pay are set per person on Team → Schedule." />
      <SettingsNav current="payroll" me={me} />
      <Card>
        <PayrollSettingsForm initial={settings} />
      </Card>
      <Card className="mt-6">
        <h2 className="mb-1 text-base font-semibold text-ink">Hours for hourly pay</h2>
        <p className="mb-4 max-w-2xl text-13 text-ink-muted">Payroll shows scheduled and clocked hours side by side for everyone paid by the hour. This chooses which of them is paid.</p>
        <PayrollHoursForm initial={settings.hours} timeClock={settings.timeClock} owner={me.role === "owner"} />
        {changes.data.length > 0 && (
          <ul aria-label="Changes to hours for hourly pay" className="mt-4 flex flex-col gap-1 border-t border-line pt-3 text-13 text-ink-muted">
            {changes.data.map((c) => (
              <li key={c.id}>
                {c.to_basis === "clocked" ? "Clocked" : "Scheduled"} hours from {formatDay(toLocal(new Date(c.created_at), me.location.timezone).date)}, by {c.staff ? `${c.staff.first_name} ${c.staff.last_name}` : "a former team member"}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
