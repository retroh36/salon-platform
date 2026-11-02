import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { salonLogoUrl } from "@/lib/branding";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { DeniseUsage, SalonSettings } from "./salon-settings";
import { SettingsNav } from "./settings-nav";
import { can } from "@/lib/permissions";
import { isConnected } from "@/lib/denise/claude";
import { healthStatus } from "@/lib/denise/health";

export const metadata: Metadata = { title: "Your salon" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const business = me.location.business;
  // Usage is counted by the salon's day (private.business_today).
  const today = todayIn(me.location.timezone);
  const since = addDays(today, -6);
  const [{ data: usage, error }, { data: limits, error: limitError }, { data: health, error: healthError }] = await Promise.all([
    supabase.from("ai_usage").select("day, feature, requests, failed_requests, input_tokens, output_tokens").eq("business_id", me.business_id).gte("day", since),
    supabase.from("businesses").select("ai_daily_token_limit").eq("id", me.business_id).single(),
    supabase.from("ai_health").select("last_ok_at, last_failed_at, last_failure").eq("business_id", me.business_id).maybeSingle(),
  ]);
  if (error) throw error;
  if (limitError) throw limitError;
  if (healthError) throw healthError;
  const tokens = (rows: typeof usage) => rows.reduce((sum, r) => sum + Number(r.input_tokens) + Number(r.output_tokens), 0);

  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Your salon" description="Your salon's name and logo, shown to your team and on messages to your clients." />
      <SettingsNav current="salon" me={me} />
      <Card title="Your salon" titleId="salon-heading">
        <SalonSettings name={business?.name ?? ""} logoUrl={salonLogoUrl(business?.logo_path)} />
      </Card>
      <Card title="Denise" titleId="denise-heading" description="Whether Denise's thinking is working, and what it uses. At the daily limit she switches to plain wording until tomorrow.">
        <DeniseUsage
          today={tokens(usage.filter((r) => r.day === today))}
          week={tokens(usage)}
          answered={usage.reduce((sum, r) => sum + r.requests, 0)}
          failed={usage.reduce((sum, r) => sum + r.failed_requests, 0)}
          limit={limits.ai_daily_token_limit}
          status={healthStatus(isConnected(), health && { lastOkAt: health.last_ok_at, lastFailedAt: health.last_failed_at, lastFailure: health.last_failure })}
          timeZone={me.location.timezone}
          canChange={can(me, "billing")}
        />
      </Card>
    </AppShell>
  );
}
