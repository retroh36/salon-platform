import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadPolicy } from "@/lib/policy-load";
import { fullName, sortStaff } from "@/lib/staff";
import { SettingsNav } from "../settings-nav";
import { PolicyForm, StaffPolicies } from "./policy-settings";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Policies" };

export default function PoliciesPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Policies />
    </Suspense>
  );
}

async function Policies() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const [policy, { data: services, error: sError }, { data: staff, error: tError }, { data: business }] = await Promise.all([
    loadPolicy(supabase, me.business_id),
    supabase.from("services").select("id, name, category").eq("business_id", me.business_id).is("archived_at", null).order("category").order("name"),
    supabase.from("staff").select("id, first_name, last_name, role, is_active").eq("business_id", me.business_id).eq("is_active", true).eq("role", "stylist"),
    supabase.from("businesses").select("name").eq("id", me.business_id).single(),
  ]);
  if (sError) throw sError;
  if (tError) throw tError;
  const stylists = sortStaff(staff).map((s) => ({ id: s.id, name: fullName(s) }));
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Settings" description="Your cancellation and no-show policy: clients see it in plain language and agree before their card is saved. Fees are charged to the card on file automatically." />
      <SettingsNav current="policies" me={me} />
      <div className="flex flex-col gap-6">
        <Card>
          <PolicyForm
            initial={policy.settings}
            waiveRoles={policy.waiveRoles}
            extra={policy.extra}
            salon={business?.name ?? "the salon"}
            services={services.map((s) => ({ id: s.id, name: s.name }))}
            stylists={stylists}
          />
        </Card>
        <Card title="Stricter rules for a stylist" description="A stylist can have a longer window or higher fees than the salon's. A visit always takes the strictest rule of everyone on it.">
          <StaffPolicies stylists={stylists} policies={policy.stylists} />
        </Card>
      </div>
    </AppShell>
  );
}
