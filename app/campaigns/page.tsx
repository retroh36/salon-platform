import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Alert, EmptyState, PageHeader } from "@/components/ui/page";
import { TableCard, numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { loadCampaigns } from "@/lib/campaigns-load";
import { can } from "@/lib/permissions";
import { formatDay } from "@/lib/schedule-format";
import { formatPrice } from "@/lib/services";
import { toLocal } from "@/lib/scheduling/time";

export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Campaigns searchParams={searchParams} />
    </Suspense>
  );
}

async function Campaigns({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const rows = await loadCampaigns(supabase, me.business_id);
  const money = can(me, "reports");
  const newLink = (
    <Link href="/clients/reports" className={buttonClass("primary")}>
      Choose who it&rsquo;s for
    </Link>
  );
  return (
    <AppShell section="campaigns" me={me}>
      <PageHeader title="Campaigns" description="One message, in your words, to a list of clients from a client report. Only clients who said yes to offers get it." actions={newLink} />
      {typeof params.sent === "string" && /^\d+$/.test(params.sent) && <Alert tone="success" className="mb-6">{`Sent to ${params.sent} clients. Until texts and email are connected, they wait in the outbox.`}</Alert>}
      {rows.length === 0 ? (
        <EmptyState title="No campaigns yet">Build a list on Client reports, or ask Denise for one, then tap Send a campaign.</EmptyState>
      ) : (
        <TableCard>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>Campaign</th>
                <th className={thClass}>Sent</th>
                <th className={`${thClass} ${numClass}`}>Got it</th>
                <th className={`${thClass} ${numClass}`}>Booked after</th>
                {money && <th className={`${thClass} ${numClass}`}>Revenue</th>}
                <th className={`${thClass} ${numClass}`}>Opted out</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={trClass} data-testid="campaign-row">
                  <td className={tdClass}>
                    <span className="font-medium text-ink">{c.name}</span>
                    <span className="block text-13 text-ink-muted">{c.description}</span>
                  </td>
                  <td className={tdClass}>
                    {formatDay(toLocal(new Date(c.sentAt), me.location.timezone).date)}
                    {c.sentBy && <span className="block text-13 text-ink-muted">by {c.sentBy}</span>}
                  </td>
                  <td className={`${tdClass} ${numClass}`}>{c.sent}</td>
                  <td className={`${tdClass} ${numClass}`}>{c.booked}</td>
                  {money && <td className={`${tdClass} ${numClass}`}>{formatPrice(c.revenueCents)}</td>}
                  <td className={`${tdClass} ${numClass}`}>{c.optedOut}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </AppShell>
  );
}
