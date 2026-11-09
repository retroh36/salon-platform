import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Alert, Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { canSendAt } from "@/lib/automations";
import { siteUrl } from "@/lib/branding";
import { audienceText, CAMPAIGN_MAX } from "@/lib/campaigns";
import { loadAudience } from "@/lib/campaigns-load";
import { decodeReport, describeReport, encodeReport, readReport, reportProblem } from "@/lib/client-reports";
import { knownOf, loadReportMenu, namesOf } from "@/lib/client-reports-load";
import { can } from "@/lib/permissions";
import { todayIn, toLocal } from "@/lib/scheduling/time";
import { CampaignForm } from "./campaign-form";

export const metadata: Metadata = { title: "New campaign" };

export default function NewCampaignPage({ searchParams }: PageProps<"/campaigns/new">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <NewCampaign searchParams={searchParams} />
    </Suspense>
  );
}

// Who it's for comes from a client report (?r=): built on that page, or by
// asking Denise for the list. What it says is staff's.
async function NewCampaign({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");
  const raw = typeof params.r === "string" ? decodeReport(params.r) : null;
  if (!raw) redirect("/clients/reports");
  const [menu, { data: b, error }] = await Promise.all([
    loadReportMenu(supabase, me.business_id),
    supabase.from("businesses").select("name, slug, free_text_roles, online_booking_settings(enabled)").eq("id", me.business_id).single(),
  ]);
  if (error) throw error;
  const read = readReport(raw, knownOf(menu));
  if (!read || reportProblem(read.report, todayIn(me.location.timezone))) redirect("/clients/reports");
  const { audience, total } = await loadAudience(supabase, me, read.report, "sms");
  const mayWrite = me.role === "owner" || b.free_text_roles.includes(me.role);
  const now = toLocal(new Date(), me.location.timezone);
  return (
    <AppShell section="campaigns" me={me}>
      <PageHeader title="New campaign" description={describeReport(read.report, namesOf(menu))} />
      <Alert tone="info" className="mb-6">
        Texts and email aren&apos;t connected yet, so for now these wait in the outbox.
      </Alert>
      <Card title="Who gets it" titleId="audience-heading">
        <p data-testid="campaign-audience" className="text-sm text-ink">
          {audienceText(audience)}
        </p>
      </Card>
      <Card title="The message" titleId="message-heading">
        {total > CAMPAIGN_MAX ? (
          <p className="text-sm text-ink">This list is over {CAMPAIGN_MAX.toLocaleString("en-US")} clients. Narrow the report first.</p>
        ) : mayWrite ? (
          <CampaignForm
            id={crypto.randomUUID()}
            encoded={encodeReport(read.report)}
            count={audience.recipients.length}
            sample={audience.recipients[0]?.firstName ?? "Ava"}
            salon={b.name}
            bookingUrl={`${siteUrl()}/book/${b.slug}?src=campaign`}
            bookingLive={Boolean(b.slug && b.online_booking_settings?.enabled)}
            canSendNow={canSendAt(now.minute)}
          />
        ) : (
          <p className="text-sm text-ink">Writing your own messages is turned off for your role. An owner can change that on Settings, under Messages.</p>
        )}
      </Card>
    </AppShell>
  );
}
