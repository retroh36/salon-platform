import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadPaySettings } from "@/lib/payroll-load";
import { SettingsNav } from "../settings-nav";
import { PayrollSettingsForm } from "./payroll-settings";
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
  const settings = await loadPaySettings(supabase, me.business_id);
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Settings" description="How often you run payroll. Commission rates and hourly pay are set per person on Team → Schedule." />
      <SettingsNav current="payroll" me={me} />
      <Card>
        <PayrollSettingsForm initial={settings} />
      </Card>
    </AppShell>
  );
}
