import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, listClass, PageHeader, rowLinkClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadTemplates, patchSettings } from "@/lib/client-checks";
import { PatchSettingsForm } from "./patch-settings";

export const metadata: Metadata = { title: "Forms · Salon Platform" };

export default function FormsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Forms />
    </Suspense>
  );
}

const REQUIRED_LABELS = { none: "Optional", first_visit: "Before a first visit", services: "Before some services" } as const;

async function Forms() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  const owner = me.role === "owner";
  const [templates, settings, { data: counts, error }] = await Promise.all([
    loadTemplates(supabase),
    patchSettings(supabase, me.business_id),
    supabase.from("services").select("id").eq("requires_patch_test", true).is("archived_at", null),
  ]);
  if (error) throw error;

  return (
    <AppShell section="forms" me={me}>
      <PageHeader
        title="Forms"
        description="Consultation and consent forms clients sign at the front desk, and patch test rules."
        actions={
          owner && (
            <Link href="/forms/new" className={buttonClass("primary", "md")}>
              New form
            </Link>
          )
        }
      />

      <Card title="Form templates" titleId="templates-heading" flush>
        {templates.length === 0 ? (
          <EmptyState>No forms yet.</EmptyState>
        ) : (
          <ul className={listClass} aria-labelledby="templates-heading">
            {templates.map((t) => (
              <li key={t.id}>
                <Link href={`/forms/${t.id}`} className={`${rowLinkClass} flex flex-wrap items-center justify-between gap-2`}>
                  <span>
                    <span className="font-semibold text-ink">{t.name}</span>
                    <span className="block text-sm text-ink-muted">
                      {t.fields.length} question{t.fields.length === 1 ? "" : "s"}
                      {t.required === "services" && ` · ${t.serviceIds.length} service${t.serviceIds.length === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <Badge tone={t.required === "none" ? "neutral" : "plum"}>{REQUIRED_LABELS[t.required]}</Badge>
                    {!t.isActive && <Badge>Off</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Patch tests" titleId="patch-heading" description={`${counts.length} services need one (set on each service).`}>
        <PatchSettingsForm initial={settings} readOnly={!owner} />
      </Card>
    </AppShell>
  );
}
