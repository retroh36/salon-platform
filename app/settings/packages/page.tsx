import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Badge, Card, PageHeader, Section } from "@/components/ui/page";
import { buttonClass } from "@/components/ui/button";
import { getCurrentStaff } from "@/lib/auth";
import { loadTemplates } from "@/lib/packages";
import { LEVEL_LABELS } from "@/lib/schedule-forms";
import { formatPrice } from "@/lib/services";
import { SettingsNav } from "../settings-nav";
import { PackageForm } from "./package-form";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Packages" };

export default function PackagesSettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <PackagesSettings />
    </Suspense>
  );
}

async function PackagesSettings() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const [templates, { data: services, error }] = await Promise.all([
    loadTemplates(supabase, me.business_id, false),
    supabase.from("services").select("id, name").eq("business_id", me.business_id).is("archived_at", null).order("name"),
  ]);
  if (error) throw error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Settings" description="Packages: services clients buy up front at one price and use over several visits." />
      <SettingsNav current="packages" me={me} />
      <Card title="New package" titleId="new-package-heading">
        <PackageForm template={null} services={services} />
      </Card>
      {templates.length > 0 && (
      <Section title="Packages" titleId="templates-heading" count={templates.length}>
      {templates.map((t) => (
        <Card
          className="mb-3"
          key={t.id}
          title={t.name}
          titleId={`package-${t.id}`}
          description={`${formatPrice(t.priceCents)} · ${t.items.map((i) => `${i.quantity} × ${i.serviceName}`).join(" + ")} · ${t.expiryMonths ? `lasts ${t.expiryMonths} months` : "never expires"}${t.levels ? ` · ${t.levels.map((l) => LEVEL_LABELS[l]).join(", ")} stylists` : ""}`}
          actions={t.isActive ? <Badge tone="green">On sale</Badge> : <Badge tone="neutral">Not on sale</Badge>}
        >
          <details>
            <summary className={buttonClass("secondary", "sm", "cursor-pointer list-none")}>Edit</summary>
            <div className="mt-4 border-t border-line pt-4">
              <PackageForm template={t} services={services} />
            </div>
          </details>
        </Card>
      ))}
      </Section>
      )}
    </AppShell>
  );
}
