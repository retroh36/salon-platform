import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, nameLinkClass, PageHeader, Section } from "@/components/ui/page";
import { TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { loadTemplates, patchSettings } from "@/lib/client-checks";
import { PatchSettingsForm } from "./patch-settings";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Forms" };

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
  const owner = can(me, "settings");
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

      <Section title="Form templates" titleId="templates-heading" count={templates.length}>
        <TableCard className="mb-0!">
          {templates.length === 0 ? (
            <EmptyState>No forms yet.</EmptyState>
          ) : (
            <table className={tableClass} aria-labelledby="templates-heading">
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>
                    Form
                  </th>
                  <th scope="col" className={thClass}>
                    Questions
                  </th>
                  <th scope="col" className={thClass}>
                    When it&apos;s needed
                  </th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className={trClass}>
                    <td className={tdClass}>
                      <Link href={`/forms/${t.id}`} className={nameLinkClass}>
                        {t.name}
                      </Link>
                      {!t.isActive && (
                        <Badge tone="neutral" className="ml-2">
                          Off
                        </Badge>
                      )}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-ink-muted tabular-nums`}>
                      {t.fields.length} question{t.fields.length === 1 ? "" : "s"}
                    </td>
                    <td className={`${tdClass} text-ink-muted`}>
                      {REQUIRED_LABELS[t.required]}
                      {t.required === "services" && ` · ${t.serviceIds.length} service${t.serviceIds.length === 1 ? "" : "s"}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </Section>

      <Card title="Patch tests" titleId="patch-heading" description={`${counts.length} services need one (set on each service).`}>
        <PatchSettingsForm initial={settings} readOnly={!owner} />
      </Card>
    </AppShell>
  );
}
