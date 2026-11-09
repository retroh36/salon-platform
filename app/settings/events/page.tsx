import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Badge, Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadEventAutomations, loadEventSettings, loadEventStages, loadPackages, loadTerms } from "@/lib/events/load";
import { EventAutomations } from "./automations-editor";
import { packageRoles, PARTY_ROLE_LABELS } from "@/lib/events/types";
import { can } from "@/lib/permissions";
import { formatPrice } from "@/lib/services";
import { formatDuration } from "@/lib/duration";
import { SettingsNav } from "../settings-nav";
import { EventPackageForm, EventSettingsForm } from "./forms";
import { EventStagesEditor } from "./stages-editor";

export const metadata: Metadata = { title: "Bridal and events" };

export default function EventSettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <EventSettingsView />
    </Suspense>
  );
}

async function EventSettingsView() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const [stages, automations, packages, settings, terms, { data: services, error }] = await Promise.all([
    loadEventStages(supabase, me.business_id),
    loadEventAutomations(supabase, me.business_id),
    loadPackages(supabase, me.business_id),
    loadEventSettings(supabase, me.business_id),
    loadTerms(supabase, me.business_id),
    supabase.from("services").select("id, name").eq("business_id", me.business_id).is("archived_at", null).order("name"),
  ]);
  if (error) throw error;
  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Bridal and events" description="The packages parties choose from, and how events are priced, paid and planned." />
      <SettingsNav current="events" me={me} />
      <Card title="Board stages" titleId="event-stages" description="The columns on the Events board. Rename and reorder them, or add your own. Events move through the six built-in stages by themselves; staff put an event in one of your own.">
        <EventStagesEditor stages={stages} />
      </Card>
      <Card title="Automations" titleId="event-automations" description="When something happens to an event, do something after a wait: send the client your message, add a to-do for the team, or move the event to one of your own stages. A message goes out only once an owner turns it on.">
        <EventAutomations automations={automations} stages={stages.filter((s) => !s.kind)} isOwner={me.role === "owner"} />
      </Card>
      <Card title="Event packages" titleId="event-packages" description="Each person in a party gets one. The minutes say how long the hair and the makeup take, and so who can do it.">
        <ul className="-mt-3 mb-6 divide-y divide-line" aria-label="Event packages">
          {packages.map((p) => (
            <li key={p.id} className="py-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className="font-medium text-ink">{p.name}</span>{" "}
                    <span className="text-sm text-ink-muted">
                      · {packageRoles(p)} · {formatDuration(p.hairMinutes + p.makeupMinutes)}
                      {p.partyRole && ` · ${PARTY_ROLE_LABELS[p.partyRole]}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {p.isTrial && <Badge tone="blue">Trial</Badge>}
                    {!p.isActive && <Badge>Not offered</Badge>}
                    <span className="tabular-nums">{formatPrice(p.priceCents)}</span>
                  </span>
                </summary>
                <div className="mt-4 border-t border-line pt-4">
                  <EventPackageForm pkg={p} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        <h3 className="mb-3 border-t border-line pt-6 text-sm font-semibold text-ink">New package</h3>
        <EventPackageForm pkg={null} />
      </Card>
      <Card title="Bridal settings" titleId="bridal-settings">
        <EventSettingsForm settings={settings} terms={terms.body} services={services} />
      </Card>
    </AppShell>
  );
}
