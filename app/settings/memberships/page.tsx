import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { benefitsText, periodName, priceText } from "@/lib/memberships";
import { loadPlans } from "@/lib/memberships-load";
import { currentProvider } from "@/lib/payments";
import { SettingsNav } from "../settings-nav";
import { PlanForm, RunRenewals } from "./plan-form";

export const metadata: Metadata = { title: "Memberships" };

export default function MembershipsSettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <MembershipsSettings />
    </Suspense>
  );
}

async function MembershipsSettings() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (me.role !== "owner") redirect("/dashboard");
  const [plans, { data: services, error }, members] = await Promise.all([
    loadPlans(supabase, me.business_id, false),
    supabase.from("services").select("id, name").eq("business_id", me.business_id).is("archived_at", null).order("name"),
    supabase.from("client_memberships").select("plan_id").eq("business_id", me.business_id).neq("status", "canceled"),
  ]);
  if (error) throw error;
  const count = new Map<string, number>();
  for (const m of members.data ?? []) if (m.plan_id) count.set(m.plan_id, (count.get(m.plan_id) ?? 0) + 1);
  const provider = currentProvider();
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Settings" description="Memberships: clients pay every week or month for included services and member prices. Sold at checkout; benefits apply there automatically." />
      <SettingsNav current="memberships" />
      {provider.testMode && (
        <Alert tone="info" className="mb-6">
          Payments are in test mode: renewals go through the test provider and no real card is charged. Stripe plugs in here when it&apos;s connected.
        </Alert>
      )}
      <Card title="Renewals" titleId="renewals-heading" description="Every night, memberships due renew on their card; failed payments are tried again after 1, 3 and 4 more days, with a notice to owners and managers, then the membership ends.">
        <RunRenewals />
      </Card>
      <Card title="New membership" titleId="new-membership-heading">
        <PlanForm plan={null} services={services} />
      </Card>
      {plans.map((p) => (
        <Card
          key={p.id}
          title={p.name}
          titleId={`plan-${p.id}`}
          description={`${priceText(p.priceCents, p.intervalUnit, p.intervalCount)} · ${benefitsText(p)}${p.minTermPeriods ? ` · at least ${p.minTermPeriods} × ${periodName(p.intervalUnit, p.intervalCount)}` : ""} · ${count.get(p.id) ?? 0} members`}
          actions={p.isActive ? <Badge tone="green">On sale</Badge> : <Badge tone="neutral">Not on sale</Badge>}
          data-testid="membership-plan"
        >
          <details>
            <summary className="cursor-pointer text-sm font-medium text-link">Edit</summary>
            <div className="mt-4">
              <PlanForm plan={p} services={services} />
            </div>
          </details>
        </Card>
      ))}
    </AppShell>
  );
}
