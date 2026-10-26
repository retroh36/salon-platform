import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, PageHeader, Section } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { points, rewardValue } from "@/lib/rewards";
import { loadRewardSettings } from "@/lib/rewards-load";
import { SettingsNav } from "../settings-nav";
import { ProgramForm, RewardForm, TiersForm } from "./reward-forms";

export const metadata: Metadata = { title: "Rewards" };

export default function RewardsSettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <RewardsSettings />
    </Suspense>
  );
}

async function RewardsSettings() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const [settings, { data: services, error }] = await Promise.all([
    loadRewardSettings(supabase, me.business_id),
    supabase.from("services").select("id, name").eq("business_id", me.business_id).is("archived_at", null).order("name"),
  ]);
  if (error) throw error;
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name;
  const tierName = (id: string | null) => settings.tiers.find((t) => t.id === id)?.name;
  const rewards = [...settings.catalog.map((r) => ({ r, active: true })), ...settings.inactive.map((r) => ({ r, active: false }))];
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Rewards" description="Clients earn points on what they spend and take rewards with them at checkout." />
      <SettingsNav current="rewards" me={me} />
      <Card title="How clients earn" titleId="program-heading">
        <ProgramForm program={settings.program} />
      </Card>
      <Section title="Tiers" titleId="tiers-heading" description="Optional. Clients move up as they spend or visit more, and back down when the last 12 months are quieter.">
        <TiersForm tiers={settings.tiers} basis={settings.program.tierBasis} services={services} />
      </Section>
      <Section title="Rewards" titleId="catalog-heading" count={rewards.length}>
        <Card title="New reward" titleId="new-reward-heading" className="mb-3">
          <RewardForm reward={null} services={services} tiers={settings.tiers} />
        </Card>
        {rewards.map(({ r, active }) => (
          <Card
            className="mb-3"
            key={r.id}
            title={r.name}
            titleId={`reward-${r.id}`}
            description={[points(r.points), rewardValue(r, serviceName), r.maxPerYear ? `${r.maxPerYear} a year` : null, r.minTierId ? `${tierName(r.minTierId)} and up` : null].filter(Boolean).join(" · ")}
            actions={active ? <Badge tone="success">In the catalog</Badge> : <Badge tone="neutral">Not offered</Badge>}
          >
            <details>
              <summary className={buttonClass("secondary", "sm", "cursor-pointer list-none")}>Edit</summary>
              <div className="mt-4 border-t border-line pt-4">
                <RewardForm reward={r} services={services} tiers={settings.tiers} active={active} />
              </div>
            </details>
          </Card>
        ))}
      </Section>
    </AppShell>
  );
}
