import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader, textLinkClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SettingsNav } from "../settings-nav";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Billing />
    </Suspense>
  );
}

const PLANS: Record<string, string> = { trial: "Free trial", pro: "Pro" };

// The salon's Maestra plan (owners only: billing). Paying for Maestra
// comes with Stripe; for now it shows the plan and Denise's daily limit.
async function Billing() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "billing")) redirect("/dashboard");
  const { data: b, error } = await supabase.from("businesses").select("plan, ai_daily_token_limit").eq("id", me.business_id).single();
  if (error) throw error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Settings" description="Your Maestra plan. Only owners see billing." />
      <SettingsNav current="billing" me={me} />
      <Card title="Plan" titleId="plan-heading">
        <p className="text-sm font-semibold text-ink" data-testid="plan">
          {PLANS[b.plan] ?? b.plan}
        </p>
        <p className="mt-0.5 text-13 text-ink-muted">Paying for Maestra online isn&rsquo;t connected yet.</p>
      </Card>
      <Card title="Denise's daily limit" titleId="limit-heading">
        <p className="text-sm text-ink tabular-nums">
          {b.ai_daily_token_limit.toLocaleString("en-US")} tokens a day.{" "}
          <Link href="/settings" className={textLinkClass}>
            Change it on Salon settings
          </Link>
        </p>
      </Card>
    </AppShell>
  );
}
